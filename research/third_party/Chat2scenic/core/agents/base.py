from abc import ABC, abstractmethod
from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain.chat_models import init_chat_model
from typing import Any, Dict
from typing import Optional
import re

from core.config import get_settings
from core.milvus_client import MilvusClient
from utils.AgentLogger import get_agent_logger

settings = get_settings()


class BaseAgent(ABC):
    
    def __init__(self, prompt_template: str, model_name: str = None, model_provider: str = None, use_rag: bool = False, think_mode: bool = False):
        self.prompt_template = ChatPromptTemplate.from_template(prompt_template)
        self.prompt_template_str = prompt_template  # Store original template string for logging
        self.model_name = model_name or settings.LLM_MODEL_NAME
        self.model_provider = model_provider or settings.LLM_PROVIDER
        
        if self.model_provider == "ollama":
            self.llm = init_chat_model(
                self.model_name, 
                model_provider=self.model_provider, 
                base_url=settings.OLLAMA_URL
            )
        else:
            self.llm = init_chat_model(self.model_name, model_provider=self.model_provider, include_thoughts=think_mode,
             api_key=settings.GOOGLE_API_KEY if self.model_provider == "google_genai" else settings.OPENAI_API_KEY)
    
        self.vector_store = MilvusClient() if use_rag else None
        self.last_formatted_prompt: Optional[str] = None  # Store last formatted prompt for logging
        self.last_response: Optional[str] = None  # Store last response for logging
        self.last_context: Optional[Dict] = None  # Store last context for logging

    @abstractmethod
    def process(self, **kwargs) -> Any:
        pass
    
    def invoke(self, context: Dict = None) -> str:
        formatted_prompt = self.prompt_template.format(**context) 

        retrieved_context = self.retrieve_context(formatted_prompt)

        if retrieved_context:
            formatted_prompt += f"\n\nRelevant Context:\n{retrieved_context}"
        
        self.last_formatted_prompt = formatted_prompt
        self.last_context = context
        
        response = self.llm.invoke([HumanMessage(content=formatted_prompt)])
        response_content = response.content
        
        # Handle Gemini thinking mode response (list with thinking + response parts)
        if isinstance(response_content, list):
            text_parts = []
            for part in response_content:
                if hasattr(part, 'text'):
                    text_parts.append(part.text)
                elif isinstance(part, str):
                    text_parts.append(part)
                elif hasattr(part, 'content'):
                    text_parts.append(part.content)
            response_content = " ".join(text_parts)
        
        self.last_response = response_content
        
        agent_logger = get_agent_logger()
        if agent_logger:
            metadata = {
                "model_name": self.model_name,
                "model_provider": self.model_provider,
                "use_rag": self.vector_store is not None,
                "retrieved_context_length": len(retrieved_context) if retrieved_context else 0
            }
            
            if hasattr(self, '_current_component_type'):
                metadata["component_type"] = self._current_component_type
            
            if hasattr(self, '_current_component_code') and self._current_component_code:
                metadata["component_code"] = self._current_component_code
            
            if hasattr(self, '_retrieved_code') and self._retrieved_code:
                metadata["retrieved_code"] = self._retrieved_code
            
            agent_logger.log_agent_interaction(
                agent_name=self.__class__.__name__,
                system_prompt=self.prompt_template_str,
                user_prompt=None,  
                full_prompt=formatted_prompt,
                context=context,
                response=response_content,
                metadata=metadata
            )
        
        return response_content
    
    def get_last_formatted_prompt(self) -> Optional[str]:
        return self.last_formatted_prompt
    
    def get_last_response(self) -> Optional[str]:
        return self.last_response

    def retrieve_context(self, query: str) -> Optional[str]:
        if not self.vector_store:
            return None
        results = self.vector_store.search(query)
        return "\n".join([doc.page_content for doc in results]) if results else None

    def _extract_code_from_response(self, response: str) -> str:
        code_block_pattern = r"```(?:scenic|python)?\n(.*?)```"
        matches = re.findall(code_block_pattern, response, re.DOTALL)
        if matches:
            return matches[0].strip()
        return response.strip()


