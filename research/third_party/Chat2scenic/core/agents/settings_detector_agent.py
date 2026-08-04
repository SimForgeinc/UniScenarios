import json
from typing import Dict, Any
from .base import BaseAgent
from core.prompts import load_prompt


class SettingsDetectorAgent(BaseAgent):
    
    def __init__(self):
        prompt = load_prompt("settings_detector")
        super().__init__(
            prompt_template=prompt,
            model_name="gemini-2.5-flash",
            model_provider="google_genai",
            use_rag=False
        )
    
    def process(self, **kwargs) -> Dict[str, Any]:
        user_query = kwargs.get("user_query", "")
        return self.detect_settings(user_query)
    
    def detect_settings(self, user_query: str) -> Dict[str, Any]:
        response = self.invoke(context={
            "user_query": user_query
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
            
            return {
                "weather": result.get("weather"),
                "map_type": result.get("map_type"),
                "suggested_map": result.get("suggested_map"),
                "time_of_day": result.get("time_of_day"),
                "blueprint": result.get("blueprint"),
                "confidence": result.get("confidence", 0.5),
                "reasoning": result.get("reasoning", "")
            }
            
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to parse settings detection response: {e}")
            print(f"[DEBUG] Response text: {response_text[:500]}...")
            return self._get_default_settings()
            
        except Exception as e:
            print(f"[ERROR] Unexpected error in detect_settings: {e}")
            return self._get_default_settings()
    
    def _get_default_settings(self) -> Dict[str, Any]:
        return {
            "weather": None,
            "map_type": None,
            "suggested_map": None,
            "time_of_day": None,
            "blueprint": None,
            "confidence": 0.0,
            "reasoning": "Detection failed, using defaults"
        }

