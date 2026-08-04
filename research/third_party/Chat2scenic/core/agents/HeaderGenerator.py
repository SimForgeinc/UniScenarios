import json
from typing import Dict, Any
from .base import BaseAgent
from core.prompts import load_prompt


class HeaderGeneratorAgent(BaseAgent):
    def __init__(self):
        prompt = load_prompt("header_generator")
        super().__init__(
            prompt_template=prompt,
            model_name="gemini-2.5-flash",
            model_provider="google_genai",
            use_rag=False
        )
    
    def process(
        self,
        user_query: str,
        carla_map: str = "Town05",
        blueprint: str = "vehicle.lincoln.mkz_2017",
        weather: str = "ClearNoon"
    ) -> Dict[str, Any]:
        return self.generate_header(user_query, carla_map, blueprint, weather)
    
    def generate_header(
        self,
        user_query: str,
        carla_map: str,
        blueprint: str,
        weather: str
    ) -> Dict[str, Any]:
        map_file_path = f"../../maps/{carla_map}.xodr"
        response = self.invoke(context={
            "user_query": user_query,
            "carla_map": carla_map,
            "map_file_path": map_file_path,
            "blueprint": blueprint,
            "weather": weather
        })
        
        try:
            response_text = response.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            elif response_text.startswith("```"):
                response_text = response_text[3:]
            
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            
            response_text = response_text.strip()
            
            result = json.loads(response_text)
            
            required_fields = ["code", "description"]
            for field in required_fields:
                if field not in result:
                    raise ValueError(f"Missing required field: {field}")
            
            return {
                "code": result["code"],
                "description": result["description"],
                "is_generated": True,
                "scenario_id": "GENERATED_HEADER"
            }
            
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to parse header generation response as JSON: {e}")
            print(f"[DEBUG] Response text: {response_text[:500]}...")
            
            fallback_code = self._generate_fallback_header(
                user_query, carla_map, map_file_path, blueprint, weather
            )
            
            return {
                "code": fallback_code,
                "description": user_query,
                "is_generated": True,
                "scenario_id": "GENERATED_HEADER_FALLBACK"
            }
            
        except Exception as e:
            print(f"[ERROR] Unexpected error in generate_header: {e}")
            
            fallback_code = self._generate_fallback_header(
                user_query, carla_map, map_file_path, blueprint, weather
            )
            
            return {
                "code": fallback_code,
                "description": user_query,
                "is_generated": True,
                "scenario_id": "GENERATED_HEADER_FALLBACK"
            }
    
    def _generate_fallback_header(
        self,
        user_query: str,
        carla_map: str,
        map_file_path: str,
        blueprint: str,
        weather: str
    ) -> str:
        return f"""description = "{user_query}"
param map = localPath('{map_file_path}')
param carla_map = '{carla_map}'
model scenic.simulators.carla.model
MODEL = '{blueprint}'
param weather = '{weather}'"""

