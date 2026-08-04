import json
import re
import logging
from typing import Dict, Any, List
from .base import BaseAgent
from core.prompts import load_prompt
from core.milvus_client import MilvusClient
from core.scenario_milvus_client import ScenarioMilvusClient


class ComponentGeneratorAgent(BaseAgent):
    def __init__(self):
        prompt = load_prompt("component_generator")
        super().__init__(
            prompt_template=prompt,
            # model_name="gemini-3-flash-preview", 
            # model_provider="google_genai",
            use_rag=False,
            think_mode=False
        )
        
        self.prompts = {
            "ego": load_prompt("component_generator_ego"),
            "adv": load_prompt("component_generator_adv"),
            "spatial": load_prompt("component_generator_spatial"),
            "requirement": load_prompt("component_generator_requirement"),
            "default": prompt
        }
        
        self.scenario_client = None
        self.doc_client = None
        
        try:
            self.scenario_client = ScenarioMilvusClient()
            print("[WARNING] ComponentGeneratorAgent: Initialized ScenarioMilvusClient")
        except Exception as e:
            print(f"[WARNING] ComponentGeneratorAgent: Failed to initialize ScenarioMilvusClient: {e}")
        
        try:
            self.doc_client = MilvusClient(collection_name="documentation", embedding_provider="google_genai", embedding_model_name="models/gemini-embedding-001")
            print("[WARNING] ComponentGeneratorAgent: Initialized documentation MilvusClient")
        except Exception as e:
            print(f"[WARNING] ComponentGeneratorAgent: Failed to initialize documentation client: {e}")
    
    def process(
        self,
        component_type: str,
        user_criteria: str,
        ready_components: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        return self.generate_component(component_type, user_criteria, ready_components)
    
    def generate_component(
        self,
        component_type: str,
        user_criteria: str,
        ready_components: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        if ready_components is None:
            ready_components = {}
        
        prompt_key = self._get_prompt_key(component_type)
        selected_prompt = self.prompts.get(prompt_key, self.prompts["default"])
        
        original_prompt = self.prompt_template
        self.prompt_template = selected_prompt
        
        reference_components = self._get_reference_components(user_criteria, component_type)
        
        # documentation = self._get_documentation(component_type)
        
        ready_components_str = self._format_ready_components(ready_components)
        
        response = self.invoke(context={
            "component_type": component_type,
            "user_criteria": user_criteria,
            "ready_components": ready_components_str,
            "reference_components": reference_components,
            # "documentation": documentation
        })
        
        self.prompt_template = original_prompt
        
        try:
            response_text = response.strip()
            
            # 1. Try to extract code from code blocks if any (just in case)
            code_match = re.search(r"```(?:scenic|python)?\n?(.*?)```", response_text, re.DOTALL)
            code = code_match.group(1).strip() if code_match else response_text.strip()
            
            # 2. Basic cleaning - if it starts/ends with quotes or seems like a single string
            if (code.startswith('"') and code.endswith('"')) or (code.startswith("'") and code.endswith("'")):
                code = code[1:-1].strip()

            
            if code:
                return {
                    "code": code,
                    "description": f"Generated {component_type}",
                    "is_generated": True,
                    "scenario_id": "GENERATED"
                }
            else: 
                logging.warning(f"No code found in response. Response content: {response_text}")
                return {
                    "code": response_text,
                    "description": f"Generated {component_type}",
                    "is_generated": True,
                    "scenario_id": "GENERATED"
                }

            
        except Exception as e:
            logging.error(f"[ERROR] Unexpected error in generate_component: {e}")
            return {
                "code": "",
                "description": "Failed to generate component",
                "is_generated": False,
                "scenario_id": "ERROR"
            }
    
    def _get_prompt_key(self, component_type: str) -> str:
        component_type_lower = component_type.lower()
        if "ego" in component_type_lower:
            return "ego"
        
        if "adversarial" in component_type_lower:
            return "adv"
        
        if "spatial" in component_type_lower:
            return "spatial"
        
        if "requirement" in component_type_lower:
            return "requirement"
        
        return "default"
    
    def _format_ready_components(self, ready_components: Dict[str, Any]) -> str:
        if not ready_components:
            return "No components are ready yet."
        
        formatted_parts = []
        for comp_type, comp_code in ready_components.items():
            if isinstance(comp_code, list):
                for i, code in enumerate(comp_code):
                    formatted_parts.append(f"## {comp_type} {i+1} ##\n{code}\n")
            else:
                formatted_parts.append(f"## {comp_type} ##\n{comp_code}\n")
        
        return "\n".join(formatted_parts)
    
    def _get_reference_components(self, query: str, component_type: str, limit: int = 3) -> str:

        if not self.scenario_client:
            return "# No reference components available"
        
        try:
            results = self.scenario_client.search_components_by_type(
                query=query,
                component_type=component_type,
                limit=limit
            )
            
            if not results:
                return "# No reference components found"
            
            formatted_refs = []
            for idx, hit in enumerate(results, 1):
                entity = hit.entity
                code = entity.get("code", "")
                description = entity.get("description", "")
                
                ref_json = {
                    "Description": description,
                    "Code": code,
                }
                formatted_refs.append(f"{json.dumps(ref_json, indent=2)}\n")
            
            return "\n".join(formatted_refs)
            
        except Exception as e:
            print(f"[ERROR] Failed to retrieve reference components: {e}")
            return "# Error retrieving reference components"
    
    def _get_documentation(self, component_type: str, top_k: int = 5) -> str:
        if not self.doc_client:
            return "# No documentation available"
        try:
            component_search_terms = {
                "Ego": "Ego,behavior,operators, specifiers",
                "Adversarial": "Adversarial,behavior,operators, specifiers",
                "Spatial Relation": "network,egoSpawnPt,intersection,egoTrajectory,advSpawnPt,advTrajectory",
                "Requirement and restrictions": "require,terminate,TrafficLight"
            }
            
            search_terms = component_search_terms.get(component_type, component_type)
            
            results = self.doc_client.search(search_terms, ranker_type="rrf", ranker_params={"k": 5})
            if not results:
                return "# No relevant documentation found"
            
            doc_contents = []
            for idx, doc in enumerate(results[:top_k], 1):
                content = doc.page_content
                doc_contents.append(f"{content}\n")
            return "\n".join(doc_contents)
            
        except Exception as e:
            print(f"[ERROR] Failed to retrieve documentation: {e}")
            return "# Error retrieving documentation"
    
    def close(self):
        try:
            if self.scenario_client:
                self.scenario_client.close()
            if self.doc_client:
                self.doc_client.close()
        except Exception as e:
            print(f"[WARNING] Error closing ComponentGeneratorAgent resources: {e}")