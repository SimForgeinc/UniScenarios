from langchain_core.messages import HumanMessage
from .base import BaseAgent
from core.prompts import load_prompt
from utils.AgentLogger import get_agent_logger

class Interpretor(BaseAgent):
    def __init__(self):
        prompt = load_prompt("interpretor")
        
        super().__init__(
            prompt_template=prompt
        )
    
    def process(self, user_query: str) -> str:
        response = self.invoke(context={"scenic_code": user_query})
        return response.strip()
    
    def adapt(self, original_query: str, current_interpretation: str, user_feedback: str) -> str:
        prompt = f"""Your task is to update the high-level logical structure of the scenario based on user feedback.

        Original query: {original_query}

        Current interpretation:
        {current_interpretation}

        User feedback: {user_feedback}

        Update the interpretation based on the user feedback. Output ONLY a valid JSON object with the following structure (NO markdown code blocks, NO additional text):

        {{
        "Scenario": "<ONE short sentence describing the main event>",
        "Ego": "<ONE short sentence describing the ego vehicle including its type (restricted to car, pedestrian) and behavior>",
        "Adversarials": [
            "<ONE short sentence describing the first adversarial object including its type (restricted to pedestrian, car, trash, debris, vending machine, bicycle, truck, etc.) and behavior>",
            "<ONE short sentence describing the second adversarial object including its type (restricted to pedestrian, car, trash, debris, vending machine, bicycle, truck, etc.) and behavior>",
            "<ONE short sentence describing the third adversarial object including its type (restricted to pedestrian, car, trash, debris, vending machine, bicycle, truck, etc.) and behavior>"
        ],
        "Spatial Relation": "<ONE short sentence describing the spatial relation of all spatial components with clear subject,  the road type (straight road, highway, intersection), how all entities are positioned relative to each other and the road>",
        "Requirement and restrictions": "<Describe the requirement and restrictions of the scenario, for example, how the scenario should be terminated, 
        what is the initial distance between the ego and the adversarial object, etc.>" 
        }}
                
        Follow the rules:
        - Do not contain spatial relation in ego and adversarials components
        - Start descriptions with the subject (e.g.,  "The ego vehicle", "Debris objects"), for example, "The ego vehicle travel forward, then make a right turn"
        - For Adversarials, create a separate entry for each distinct adversarial object in the scenario
        - Combine object type and behavior in a single description


        Example 1 (single ego, single adversarial):
        {{
        "Scenario": "Ego vehicle goes straight and an adversary vehicle makes a right turn at 3-way intersection.",
        "Ego": "A car travels forward and decelerates if it gets too close to other objects",
        "Adversarials": [
            "A car travels forward, then makes a right turn"
        ],
        "Spatial Relation": "The ego and adversarial vehicles are positioned on incoming lanes at a 3-way intersection.",
        "Requirement and restrictions": "The initial distance of the ego vehicle to the intersection and the adversarial vehicle to the intersection are restricted. The scenario terminates when the ego vehicle has traveled a certain distance from its spawn point."
        }}

        Apply the user feedback to update the relevant fields. Output ONLY the JSON object:"""
                
        response = self.llm.invoke([HumanMessage(content=prompt)])
        response_content = response.content.strip()
        
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_agent_interaction(
                agent_name=f"{self.__class__.__name__}.adapt",
                system_prompt="Adaptation prompt for updating logical structure based on user feedback",
                user_prompt=None,
                full_prompt=prompt,
                context={
                    "original_query": original_query,
                    "current_interpretation": current_interpretation,
                    "user_feedback": user_feedback
                },
                response=response_content,
                metadata={
                    "model_name": self.model_name,
                    "model_provider": self.model_provider,
                    "method": "adapt"
                }
            )
        
        return response_content

