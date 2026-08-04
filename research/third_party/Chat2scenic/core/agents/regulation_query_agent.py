import logging
import re
from typing import Dict, List, Optional

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate

from core.config import get_settings
from core.regulation_milvus_client import RegulationMilvusClient

settings = get_settings()
logger = logging.getLogger(__name__)


QUERY_DETECTION_PROMPT = """You are an assistant that determines if a user query is asking about regulations/documentation or requesting scenario generation.

User Query: {user_query}

Analyze if this query is:
1. A REGULATION_QUERY - asking about regulations, standards, requirements, available scenarios in regulations, what a regulation says, etc.
   Examples: "What scenarios are in R171?", "What does R157 say about lane keeping?", "List benchmark scenarios", "What are the test requirements in UN R152?"
   
2. A SCENARIO_REQUEST - requesting to generate or create a specific driving scenario
   Examples: "Create a scenario where ego follows another vehicle", "Generate a lane change scenario", "Ego vehicle yields at intersection"

Respond with ONLY one of these two options:
- REGULATION_QUERY
- SCENARIO_REQUEST

Your answer:"""


REGULATION_RESPONSE_PROMPT = """You are a helpful assistant that answers questions about autonomous driving regulations and standards.

User Question: {user_query}

Available Context from Regulations Database:
{context}

Based on the context above, answer to the user's question.
- If they asked for scenarios, list them clearly
- If they asked about specific requirements, explain them
- If the context doesn't fully answer the question, say what you found and suggest they ask more specifically
- Format your response using markdown for readability
- If listing scenarios, use bullet points or numbered lists

Your response:"""


class RegulationQueryAgent:
    def __init__(self):
        self.model_name = settings.LLM_MODEL_NAME
        self.model_provider = settings.LLM_PROVIDER
        
        if self.model_provider == "ollama":
            self.llm = init_chat_model(
                self.model_name, 
                model_provider=self.model_provider, 
                base_url=settings.OLLAMA_URL
            )
        else:
            self.llm = init_chat_model(
                self.model_name, 
                model_provider=self.model_provider,
                api_key=settings.GOOGLE_API_KEY if self.model_provider == "google_genai" else settings.OPENAI_API_KEY
            )
        
        self.detection_prompt = ChatPromptTemplate.from_template(QUERY_DETECTION_PROMPT)
        self.response_prompt = ChatPromptTemplate.from_template(REGULATION_RESPONSE_PROMPT)
        
        # Initialize regulation client (lazy loading)
        self._regulation_client = None
    
    @property
    def regulation_client(self) -> RegulationMilvusClient:
        """Lazy initialization of regulation client."""
        if self._regulation_client is None:
            try:
                self._regulation_client = RegulationMilvusClient()
            except Exception as e:
                logger.error(f"❌ Failed to initialize RegulationMilvusClient: {e}")
                raise
        return self._regulation_client
    
    def detect_query_type(self, user_query: str) -> str:
        query_lower = user_query.lower()
        regulation_keywords = [
            "regulation", "r171", "r157", "r152", "benchmark", "nhtsa",
            "what scenario", "list scenario", "available scenario",
            "what does", "according to", "requirement", "standard",
            "un regulation", "carla leaderboard"
        ]
        
        for keyword in regulation_keywords:
            if keyword in query_lower:
                logger.info(f"🔍 Detected regulation query via keyword: '{keyword}'")
                return "REGULATION_QUERY"
        
        try:
            formatted_prompt = self.detection_prompt.format(user_query=user_query)
            response = self.llm.invoke([HumanMessage(content=formatted_prompt)])
            result = response.content.strip().upper()
            
            if "REGULATION" in result:
                return "REGULATION_QUERY"
            return "SCENARIO_REQUEST"
            
        except Exception as e:
            logger.warning(f"⚠️ Query detection failed, defaulting to SCENARIO_REQUEST: {e}")
            return "SCENARIO_REQUEST"
    
    def extract_regulation_filter(self, user_query: str) -> Optional[str]:
        query_upper = user_query.upper()
        
        patterns = [
            (r'\bR171\b', 'R171'),
            (r'\bR157\b', 'R157'),
            (r'\bR152\b', 'R152'),
            (r'\bUN\s*R\s*171\b', 'R171'),
            (r'\bUN\s*R\s*157\b', 'R157'),
            (r'\bUN\s*R\s*152\b', 'R152'),
            (r'\bBENCHMARK\b', 'BENCHMARK'),
            (r'\bNHTSA\b', 'BENCHMARK'),
            (r'\bCARLA\b', 'BENCHMARK'),
        ]
        
        for pattern, reg_id in patterns:
            if re.search(pattern, query_upper):
                return reg_id
        
        return None
    
    def search_regulations(self, query: str, limit: int = 10) -> List[Dict]:
        try:
            regulation_filter = self.extract_regulation_filter(query)
            
            if regulation_filter:
                logger.info(f"🔍 Searching in regulation: {regulation_filter}")
                results = self.regulation_client.search_by_regulation(query, regulation_filter, limit)
            else:
                logger.info(f"🔍 Searching across all regulations")
                results = self.regulation_client.search(query, limit)
            
            return results
            
        except Exception as e:
            logger.error(f"❌ Regulation search failed: {e}")
            return []
    
    def format_context(self, search_results: List[Dict]) -> str:
        if not search_results:
            return "No relevant information found in the regulations database."
        
        context_parts = []
        for i, result in enumerate(search_results, 1):
            reg_id = result.get("regulation_id", "Unknown")
            section = result.get("section", "")
            content = result.get("content", "")
            score = result.get("score", 0)
            
            context_parts.append(
                f"{content}\n"
            )
        
        return "\n\n".join(context_parts)
    
    def process(self, user_query: str) -> Dict:
        logger.info(f"📚 Processing regulation query: {user_query[:100]}...")
        
        # Search regulations
        search_results = self.search_regulations(user_query)
        
        if not search_results:
            return {
                "response": "I couldn't find relevant information in the regulations database. Please try rephrasing your question or ask about a specific regulation (e.g., R171, R157, R152, or benchmark scenarios).",
                "sources": [],
                "query_type": "REGULATION_QUERY"
            }
        
        # Format context
        context = self.format_context(search_results)
        
        # Generate response
        try:
            formatted_prompt = self.response_prompt.format(
                user_query=user_query,
                context=context
            )
            response = self.llm.invoke([HumanMessage(content=formatted_prompt)])
            response_content = response.content
            
            # Handle list response (from some models)
            if isinstance(response_content, list):
                response_content = "\n".join(str(part) for part in response_content)
            
            # Add source references
            sources = list(set(r.get("regulation_id", "") for r in search_results if r.get("regulation_id")))
            source_note = f"\n\n---\n📖 *Sources: {', '.join(sources)}*"
            
            return {
                "response": response_content + source_note,
                "sources": sources,
                "query_type": "REGULATION_QUERY"
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to generate response: {e}")
            return {
                "response": f"I found relevant information but encountered an error generating the response: {e}",
                "sources": [],
                "query_type": "REGULATION_QUERY"
            }
    
    def get_available_regulations(self) -> List[str]:
        try:
            return self.regulation_client.get_available_regulations()
        except Exception as e:
            logger.error(f"❌ Failed to get available regulations: {e}")
            return []
    
    def close(self):
        if self._regulation_client:
            try:
                self._regulation_client.close()
            except Exception as e:
                logger.warning(f"Warning closing regulation client: {e}")
            self._regulation_client = None
