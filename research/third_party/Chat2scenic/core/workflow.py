from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage, AIMessage
from typing import Literal, TypedDict, Annotated
import logging
import time

from .agents.Interpretor import Interpretor
from .agents.component_generator_agent import ComponentGeneratorAgent
from .agents.HeaderGenerator import HeaderGeneratorAgent
from .agents.settings_detector_agent import SettingsDetectorAgent
from .agents.regulation_query_agent import RegulationQueryAgent
from .config import get_settings
from .scenario_milvus_client import ScenarioMilvusClient
from utils.parser import parse_json_from_text
from utils.AgentLogger import get_agent_logger

settings = get_settings()


class SearchWorkflowState(TypedDict):
    messages: Annotated[list, add_messages]
    user_query: str
    query_type: str  # "REGULATION_QUERY" or "SCENARIO_REQUEST"
    logical_interpretation: str
    user_feedback: str
    confirmation_status: str
    selected_code: str
    adapted_code: str
    workflow_status: str
    component_scores: dict
    retrieved_components: dict
    scenario_settings: dict
    generation_start_time: float
    component_sources: dict
    generation_time: str
    generation_duration: float


class SearchWorkflow:
    def __init__(self, thread_id: str = "search_thread"):
        self.thread_id = thread_id
        self.interpretor = Interpretor()
        self.generator_agent = ComponentGeneratorAgent()
        self.header_generator = HeaderGeneratorAgent()
        self.settings_detector = SettingsDetectorAgent()
        self.regulation_query_agent = RegulationQueryAgent()
        self.generation_threshold = 50
        
        try:
            self.milvus_client = ScenarioMilvusClient(collection_name="scenario_components")
        except Exception as e:
            self.milvus_client = None
        
        self.workflow = StateGraph(state_schema=SearchWorkflowState)
        
        self.workflow.add_node("detect_query_type", self._detect_query_type_node)
        self.workflow.add_node("answer_regulation_query", self._answer_regulation_query_node)
        self.workflow.add_node("interpret_query", self._interpret_query_node)
        self.workflow.add_node("handle_feedback", self._handle_feedback_node)
        self.workflow.add_node("detect_settings", self._detect_settings_node)
        self.workflow.add_node("generate_header", self._generate_header_node)
        self.workflow.add_node("generate_components", self._generate_components_node)
        self.workflow.add_node("assemble_code", self._assemble_code_node)
        
        self.workflow.add_conditional_edges(
            START,
            self._decide_start_point,
            {
                "detect_type": "detect_query_type",
                "interpret": "interpret_query",
                "feedback": "handle_feedback",
                "search": "detect_settings"
            }
        )
        
        self.workflow.add_conditional_edges(
            "detect_query_type",
            self._route_by_query_type,
            {
                "regulation": "answer_regulation_query",
                "scenario": "interpret_query"
            }
        )
        
        self.workflow.add_edge("answer_regulation_query", END)
        
        self.workflow.add_conditional_edges(
            "interpret_query",
            self._check_confirmation,
            {
                "confirmed": "detect_settings",
                "needs_feedback": END
            }
        )
        
        self.workflow.add_conditional_edges(
            "handle_feedback",
            self._after_feedback,
            {
                "search": "detect_settings",
                "needs_feedback": END
            }
        )
        
        self.workflow.add_edge("detect_settings", "generate_header")
        self.workflow.add_edge("generate_header", "generate_components")
        self.workflow.add_edge("generate_components", "assemble_code")
        self.workflow.add_edge("assemble_code", END)
        
        self.memory = MemorySaver()
        self.app = self.workflow.compile(checkpointer=self.memory)
       
    def _decide_start_point(self, state: SearchWorkflowState) -> Literal["detect_type", "interpret", "feedback", "search"]:
        # If user provided feedback, handle it
        if state.get("confirmation_status") == "rejected":
            return "feedback"
        # If we already have interpretation and confirmed, continue to search
        elif state.get("logical_interpretation") and state.get("confirmation_status") == "confirmed":
            return "search"
        # For new queries, first detect if it's a regulation query or scenario request
        return "detect_type"
    
    def _route_by_query_type(self, state: SearchWorkflowState) -> Literal["regulation", "scenario"]:
        """Route based on detected query type."""
        query_type = state.get("query_type", "SCENARIO_REQUEST")
        if query_type == "REGULATION_QUERY":
            return "regulation"
        return "scenario"
    
    def _check_confirmation(self, state: SearchWorkflowState) -> Literal["confirmed", "needs_feedback"]:
        return "confirmed" if state.get("confirmation_status") == "confirmed" else "needs_feedback"
    
    def _after_feedback(self, state: SearchWorkflowState) -> Literal["search", "needs_feedback"]:
        return "search" if state.get("confirmation_status") == "confirmed" else "needs_feedback"
    
    def _retrieve_components_by_scenario_id(self, scenario_id: str) -> dict:
        if not self.milvus_client:
            return {}
        try:
            return self.milvus_client.get_all_components_by_scenario_id(scenario_id)
        except Exception as e:
            logging.error(f"❌ Failed to retrieve components for {scenario_id}: {e}")
            return {}
    
    def _detect_query_type_node(self, state: SearchWorkflowState):
        """Detect if the user query is about regulations or a scenario request."""
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "detect_query_type",
                "user_query": state.get("user_query", "")
            })
        
        user_query = state.get("user_query", "")
        
        try:
            query_type = self.regulation_query_agent.detect_query_type(user_query)
            logging.info(f"🔍 Detected query type: {query_type}")
        except Exception as e:
            logging.warning(f"⚠️ Failed to detect query type: {e}, defaulting to SCENARIO_REQUEST")
            query_type = "SCENARIO_REQUEST"
        
        state["query_type"] = query_type
        
        if agent_logger:
            agent_logger.log_workflow_event("node_exit", {
                "node": "detect_query_type",
                "query_type": query_type
            })
        
        return state
    
    def _answer_regulation_query_node(self, state: SearchWorkflowState):
        """Answer a regulation-related query using the RAG system."""
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "answer_regulation_query",
                "user_query": state.get("user_query", "")
            })
        
        user_query = state.get("user_query", "")
        logging.info(f"📚 Answering regulation query: {user_query[:100]}...")
        
        try:
            result = self.regulation_query_agent.process(user_query)
            response = result.get("response", "I couldn't find relevant information.")
            sources = result.get("sources", [])
            
            logging.info(f"✅ Found information from sources: {sources}")
            
        except Exception as e:
            logging.error(f"❌ Failed to answer regulation query: {e}")
            response = f"I encountered an error while searching the regulations database: {str(e)}"
        
        # Add helpful follow-up message
        follow_up = (
            "\n\n---\n"
            "💡 **What would you like to do next?**\n"
            "- Ask another question about regulations\n"
            "- Request a scenario generation (e.g., \"Create a scenario where ego vehicle follows another vehicle\")"
        )
        
        state["messages"].append(AIMessage(content=response + follow_up))
        state["workflow_status"] = "completed"
        
        if agent_logger:
            agent_logger.log_workflow_event("node_exit", {
                "node": "answer_regulation_query",
                "response_length": len(response)
            })
        
        return state
    
    def _interpret_query_node(self, state: SearchWorkflowState):
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "interpret_query",
                "user_query": state.get("user_query", "")
            })
        
        logical_interpretation = self.interpretor.process(state["user_query"])
        
        formatted_response = (
            f"**Logical Scenario Structure:**\n{logical_interpretation}\n\n"
            f"**Next steps:**\n"
            f"- To proceed, reply with 'yes' or 'ok'.\n"
            f"- If you need changes, reply with specific feedback."
        )
        state["logical_interpretation"] = logical_interpretation
        state["workflow_status"] = "awaiting_confirmation"
        state["messages"].append(AIMessage(content=formatted_response))
        
        if agent_logger:
            agent_logger.log_workflow_event("node_exit", {
                "node": "interpret_query",
                "logical_interpretation": logical_interpretation,
                "workflow_status": state["workflow_status"]
            })
        
        return state
    
    def _handle_feedback_node(self, state: SearchWorkflowState):
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "handle_feedback",
                "user_feedback": state.get("user_feedback", "")
            })
        
        updated_interpretation = self.interpretor.adapt(
            state.get("user_query", ""),
            state.get("logical_interpretation", ""),
            state.get("user_feedback", "")
        )
        
        formatted_response = (
            f"**Updated Logical Scenario Structure:**\n{updated_interpretation}\n\n"
            f"**Next steps:**\n"
            f"- To proceed, reply with 'yes' or 'ok'.\n"
            f"- If you need changes, reply with specific feedback."
        )
        
        state["logical_interpretation"] = updated_interpretation
        state["workflow_status"] = "awaiting_confirmation"
        state["messages"].append(AIMessage(content=formatted_response))
        
        if agent_logger:
            agent_logger.log_workflow_event("node_exit", {
                "node": "handle_feedback",
                "updated_interpretation": updated_interpretation
            })
        
        return state

    def _generate_components_node(self, state: SearchWorkflowState):
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "generate_components"
            })

        logical_interpretation = state.get("logical_interpretation", "")
        raw_criteria = parse_json_from_text(logical_interpretation) or {}

        key_mapping = {
            "ego": "Ego",
            "spatial relation": "Spatial Relation",
            "spatialrelation": "Spatial Relation",
            "spatial_relation": "Spatial Relation",
            "spatialrelations": "Spatial Relation",
            "adversarials": "Adversarials",
            "adversarial": "Adversarials",
            "adversary": "Adversarials",
            "requirement and restrictions": "Requirement and restrictions",
            "requirement and restriction": "Requirement and restrictions",
            "requirement_and_restrictions": "Requirement and restrictions",
            "requirements": "Requirement and restrictions",
            "requirement": "Requirement and restrictions",
            "header": "Header",
            "scenario": "Scenario"
        }

        normalized_criteria = {}
        for k, v in raw_criteria.items():
            if not isinstance(k, str):
                continue
            normalized_key = key_mapping.get(k.strip().lower(), k)
            normalized_criteria[normalized_key] = v

        if "retrieved_components" not in state or state["retrieved_components"] is None:
            state["retrieved_components"] = {}
        if "component_sources" not in state or state["component_sources"] is None:
            state["component_sources"] = {}

        retrieved_components = state["retrieved_components"]
        component_sources = state["component_sources"]

        component_scores = {}

        generation_order = ["Spatial Relation", "Ego", "Adversarials", "Requirement and restrictions"]
        for component_type in generation_order:
            if component_type not in normalized_criteria:
                continue

            user_criteria = normalized_criteria.get(component_type)
            if component_type == "Adversarials":
                if not isinstance(user_criteria, list) or not user_criteria:
                    continue

                generated_list = []
                individual_scores = []
                for i, criteria in enumerate(user_criteria):
                    temp_retrieved = dict(retrieved_components)
                    temp_retrieved["Adversarials"] = list(generated_list)
                    generated = self._generate_component("Adversarial", str(criteria), temp_retrieved, component_scores)
                    if generated and generated.get("component"):
                        generated_list.append(generated["component"])
                        individual_scores.append(generated.get("score_result", {}))
                        component_sources[f"Adversarials_{i}"] = "GENERATED"

                if generated_list:
                    retrieved_components["Adversarials"] = generated_list
                    avg_score = (
                        sum(s.get("score", 0) for s in individual_scores) / len(individual_scores)
                        if individual_scores else 0
                    )
                    component_scores["Adversarials"] = {
                        "score": avg_score,
                        "is_satisfied": True,
                        "individual_scores": individual_scores,
                        "user_criteria": user_criteria,
                        "retrieved_description": [item.get("description", "") for item in generated_list if isinstance(item, dict)]
                    }
            else:
                if user_criteria is None or (isinstance(user_criteria, str) and not user_criteria.strip()):
                    continue

                generated = self._generate_component(component_type, str(user_criteria), retrieved_components, component_scores)
                if generated and generated.get("component"):
                    retrieved_components[component_type] = generated["component"]
                    component_sources[component_type] = "GENERATED"
                    component_scores[component_type] = generated.get("score_result", {})

        state["retrieved_components"] = retrieved_components
        state["component_sources"] = component_sources
        state["component_scores"] = component_scores

        if agent_logger:
            agent_logger.log_workflow_event("node_exit", {
                "node": "generate_components",
                "generated_components": list(retrieved_components.keys())
            })

        return state
    
    def _build_ready_components(self, retrieved_components: dict, component_scores: dict, current_component: str) -> dict:
        processing_order = ["Header", "Spatial Relation", "Ego", "Adversarials", "Requirement and restrictions"]
        
        # Map singular component names used in generation to the plural types used in the processing order
        type_mapping = {
            "Adversarial": "Adversarials",
            "Requirement": "Requirement and restrictions"
        }
        break_type = type_mapping.get(current_component, current_component)
        
        ready_components = {}
        
        for comp_type in processing_order:
            # For list components like "Adversarials", we want to allow adding the already generated 
            # items (which are in retrieved_components) as context for the next item in the same list.
            # But we must break AFTER processing it if the current_component is an individual item of that type.
            
            if comp_type == break_type:
                # If it's a list component, process it first then break
                if comp_type == "Adversarials":
                    comp_data = retrieved_components.get(comp_type, {})
                    if isinstance(comp_data, list):
                        adv_codes = [adv.get("code", "") for adv in comp_data if adv.get("code")]
                        if adv_codes:
                            ready_components[comp_type] = adv_codes
                break
            
            if comp_type not in retrieved_components:
                continue
            
            comp_data = retrieved_components.get(comp_type, {})
            
            if comp_type == "Adversarials":
                if isinstance(comp_data, list):
                    adv_codes = [adv.get("code", "") for adv in comp_data if adv.get("code")]
                    if adv_codes:
                        ready_components[comp_type] = adv_codes
            else:
                if isinstance(comp_data, dict) and comp_data.get("code"):
                    ready_components[comp_type] = comp_data.get("code", "")
        
        return ready_components
    
    def _generate_component(self, component_type: str, user_criteria: str, retrieved_components: dict, component_scores: dict = None):
        if component_scores is None:
            component_scores = {}
        
        ready_components = self._build_ready_components(retrieved_components, component_scores, component_type)
        
        generated_component = self.generator_agent.generate_component(
            component_type=component_type,
            user_criteria=user_criteria,
            ready_components=ready_components
        )
        
        # Ensure we always have a code string even if generation failed
        code = generated_component.get("code", "")
        
        logging.info(f"✅ Generated new component: {component_type} (length: {len(code)})")
        
        generated_score = {
            "score": 100 if code else 0,
            "is_satisfied": True if code else False,
            "differences": "Generated component" if code else "Generation failed",
            "user_criteria": user_criteria,
            "retrieved_description": generated_component.get("description", "No description")
        }
        
        return {
            "component": generated_component,
            "score": 100 if code else 0,
            "score_result": generated_score
        }
    
    def _assemble_code_node(self, state: SearchWorkflowState):
        retrieved_components = state.get("retrieved_components", {})
        
        if not retrieved_components:
            return state
        
        logging.info(f"🧩 Assembling scenario by concatenating components")
        logging.info(f"🔍 Available components: {list(retrieved_components.keys())}")
        
        component_order = ["Header", "Spatial Relation", "Ego", "Adversarials", "Requirement and restrictions"]
        code_parts = []
        component_scores = state.get("component_scores", {})
        
        for component_type in component_order:
            if component_type not in retrieved_components:
                # Only log as a potential issue if it was expected in component_scores or is Header
                if component_type == "Header" or component_type in component_scores:
                    logging.info(f"⚠️ Component {component_type} not found in retrieved_components")
                continue
            
            comp_data = retrieved_components.get(component_type, {})
            
            if component_type == "Adversarials":
                if isinstance(comp_data, list):
                    for adv in comp_data:
                        if isinstance(adv, dict) and adv.get("code"):
                            code_parts.append(adv.get("code", ""))
                            logging.info(f"✅ Added {component_type} code")
            else:
                if isinstance(comp_data, dict) and comp_data.get("code"):
                    code_parts.append(comp_data.get("code", ""))
                    logging.info(f"✅ Added {component_type} code")
                else:
                    logging.info(f"⚠️ Component {component_type} has no code. Type: {type(comp_data)}, Keys: {comp_data.keys() if isinstance(comp_data, dict) else 'N/A'}")
        
        final_code = "\n\n".join(code_parts)
        
        state["selected_code"] = final_code
        state["adapted_code"] = final_code
        
        start_time = state.get("generation_start_time", time.time())
        end_time = time.time()
        duration = end_time - start_time
        minutes = int(duration // 60)
        seconds = duration % 60
        time_str = f"{minutes}m {seconds:.2f}s" if minutes > 0 else f"{seconds:.2f}s"
        state["generation_time"] = time_str
        state["generation_duration"] = duration
        
        component_sources = state.get("component_sources", {})
        logging.info("=" * 30)
        logging.info("SCENARIO GENERATION SUMMARY")
        logging.info("=" * 30)
        logging.info(f"Total Generation Time: {time_str}")
        logging.info("")
        logging.info("Component Sources:")
        logging.info("-" * 30)
        for comp_type in ["Header", "Ego", "Adversarials", "Spatial Relation", "Requirement and restrictions"]:
            if comp_type in component_sources:
                logging.info(f"  {comp_type:30s} -> {component_sources[comp_type]}")
            elif comp_type == "Adversarials":
                adv_components = {k: v for k, v in component_sources.items() if k.startswith("Adversarials_")}
                for adv_name, adv_source in sorted(adv_components.items()):
                    display_name = adv_name.replace("_", " ").title()
                    logging.info(f"  {display_name:30s} -> {adv_source}")
        logging.info("=" * 30)

        formatted_output = (
            f"```scenic\n{final_code}\n```\n\n"
            f"✅ **Workflow completed!** Scenario generated successfully.\n\n"
            f"⏱️ Generation time: {time_str}"
        )
        state["messages"].append(AIMessage(content=formatted_output))
        state["workflow_status"] = "completed"
        
        return state
    
    
    def _detect_settings_node(self, state: SearchWorkflowState):
        if state.get("generation_start_time") is None:
            state["generation_start_time"] = time.time()
        
        if "component_sources" not in state:
            state["component_sources"] = {}
        
        if "retrieved_components" not in state:
            state["retrieved_components"] = {}
        
        if "Header" not in state["retrieved_components"]:
            state["retrieved_components"]["Header"] = {}

        if "scenario_settings" not in state or state["scenario_settings"] is None:
            state["scenario_settings"] = {}
        
        user_query = state.get("user_query", "")
        selected_map = state["scenario_settings"].get("selected_map")
        selected_blueprint = state["scenario_settings"].get("selected_blueprint")
        selected_weather = state["scenario_settings"].get("selected_weather")

        detected_settings = None
        
        if not selected_map or not selected_weather or not selected_blueprint:
            logging.info(f"🔍 Auto-detecting settings from user query...")
            detected_settings = self.settings_detector.detect_settings(user_query)
            
            if detected_settings["confidence"] >= 0.6:
                if not selected_weather and detected_settings["weather"]:
                    selected_weather = detected_settings["weather"]
                    logging.info(f"🌤️ Auto-detected weather: {selected_weather} (confidence: {detected_settings['confidence']:.2f})")
                    logging.info(f"   Reasoning: {detected_settings['reasoning']}")
                
                if not selected_map and detected_settings["suggested_map"]:
                    selected_map = detected_settings["suggested_map"]
                    logging.info(f"🗺️ Auto-detected map: {selected_map} (confidence: {detected_settings['confidence']:.2f})")
                    logging.info(f"   Reasoning: {detected_settings['reasoning']}")

                if not selected_blueprint and detected_settings["blueprint"]:
                    selected_blueprint = detected_settings["blueprint"]
                    logging.info(f"🚗 Auto-detected blueprint: {selected_blueprint} (confidence: {detected_settings['confidence']:.2f})")
                    logging.info(f"   Reasoning: {detected_settings['reasoning']}")
            else:
                logging.info(f"⚠️ Low confidence ({detected_settings['confidence']:.2f}) in auto-detection, using defaults")
        
        if not selected_map:
            selected_map = "Town05"
            logging.info(f"🗺️ Using default map: {selected_map}")
        if not selected_weather:
            selected_weather = "ClearNoon"
            logging.info(f"🌤️ Using default weather: {selected_weather}")
        if not selected_blueprint:
            selected_blueprint = "vehicle.lincoln.mkz_2017"
            logging.info(f"🚗 Using default blueprint: {selected_blueprint}")

        state["scenario_settings"].update({
            "selected_map": selected_map,
            "selected_weather": selected_weather,
            "selected_blueprint": selected_blueprint,
            # Full detector payload (confidence, reasoning, suggestions, etc.)
            # "detected_settings": detected_settings,
        })
        
        return state
    
    def _generate_header_node(self, state: SearchWorkflowState):
        
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "generate_header"
            })
        
        user_query = state.get("user_query", "")
        scenario_settings = state.get("scenario_settings", {}) or {}
        selected_map = scenario_settings.get("selected_map") or "Town05"
        selected_blueprint = scenario_settings.get("selected_blueprint") or "vehicle.lincoln.mkz_2017"
        selected_weather = scenario_settings.get("selected_weather") or "ClearNoon"
        
        logging.info(f"🎨 Generating Header component")
        header_component = self.header_generator.generate_header(
            user_query=user_query,
            carla_map=selected_map,
            blueprint=selected_blueprint,
            weather=selected_weather
        )
        
        state["retrieved_components"]["Header"] = header_component
        state["component_sources"]["Header"] = "GENERATED"
        
        return state
    
    def _search_scenario_node(self, state: SearchWorkflowState):
        
        agent_logger = get_agent_logger()
        if agent_logger:
            agent_logger.log_workflow_event("node_entry", {
                "node": "search_scenario",
                "logical_interpretation": state.get("logical_interpretation", "")
            })
        
        if not self.milvus_client:
            state["workflow_status"] = "completed"
            state["messages"].append(AIMessage(content="Error: Milvus database not connected."))
            return state
        
        logical_interpretation = parse_json_from_text(state["logical_interpretation"])
        scenario_description = logical_interpretation.get("Scenario", "")
        
        logging.info(f"🔍 Searching for scenarios")
        
        try:
            results = self.milvus_client.search_scenario(query=scenario_description, limit=5)
            
            if not results:
                state["workflow_status"] = "completed"
                state["messages"].append(AIMessage(content="No matching scenario found."))
                return state
            
            best_hit = results[0]
            entity = best_hit.entity
            search_result = {
                "scenario_id": entity.get("scenario_id", ""),
                "component_type": entity.get("component_type"),
                "description": entity.get("description"),
                "code": entity.get("code", ""),
                "score": float(best_hit.score)
            }
            
            logging.info(f"✅ Selected scenario: {search_result['scenario_id']}")
            
            state["selected_code"] = search_result["code"]
            state["search_results"] = [search_result]
            
            if agent_logger:
                agent_logger.log_workflow_event("node_exit", {
                    "node": "search_scenario",
                    "scenario_id": search_result['scenario_id'],
                    "search_score": search_result['score']
                })
        except Exception as e:
            logging.error(f"❌ Search failed: {e}")
            state["workflow_status"] = "completed"
            state["messages"].append(AIMessage(content=f"Error searching database: {e}"))
        return state
    

    def _prepare_state(self, user_input, user_feedback, validate_only, code_to_validate, selected_blueprint, selected_map, selected_weather, auto_correction):
        config = {"configurable": {"thread_id": self.thread_id}}
        
        current_state = self.app.get_state(config)
        
        if current_state.values:
            state = dict(current_state.values)
        else:
            state = {
                "messages": [],
                "user_query": "",
                "query_type": "",
                "logical_interpretation": "",
                "user_feedback": "",
                "confirmation_status": "",
                "selected_code": "",
                "adapted_code": "",
                "workflow_status": "",
                "component_scores": {},
                "retrieved_components": {},
                "scenario_settings": {},
                "component_sources": {},
                "generation_start_time": None,
                "generation_time": "",
                "generation_duration": 0.0
            }

        # Store explicit selections (if provided) into canonical scenario_settings.
        state.setdefault("scenario_settings", {})
        if selected_blueprint:
            state["scenario_settings"]["selected_blueprint"] = selected_blueprint
        if selected_map:
            state["scenario_settings"]["selected_map"] = selected_map
        if selected_weather:
            state["scenario_settings"]["selected_weather"] = selected_weather
        
        # Validation/auto-correction is intentionally disabled in this workflow.
        if validate_only and code_to_validate:
            state["adapted_code"] = code_to_validate
            state["selected_code"] = code_to_validate
            state["workflow_status"] = "completed"
            state["messages"].append(AIMessage(content=f"```scenic\n{code_to_validate}\n```\n\n⚠️ Validation is disabled in this workflow."))
            return state, config

        if user_feedback:
            user_feedback_lower = user_feedback.strip().lower()
            if user_feedback_lower in ["yes", "ok", "y", "confirm"]:
                state["confirmation_status"] = "confirmed"
                state["user_feedback"] = ""
            else:
                state["confirmation_status"] = "rejected"
                state["user_feedback"] = user_feedback
            state["messages"].append(HumanMessage(content=user_feedback))
        elif user_input:
            # Reset generation-related state for a new query
            state["user_query"] = user_input
            state["query_type"] = ""
            state["logical_interpretation"] = ""
            state["user_feedback"] = ""
            state["confirmation_status"] = ""
            state["selected_code"] = ""
            state["adapted_code"] = ""
            state["workflow_status"] = ""
            state["component_scores"] = {}
            state["retrieved_components"] = {}
            state["component_sources"] = {}
            state["generation_start_time"] = None
            state["scenario_settings"] = {}
            
            state["messages"].append(HumanMessage(content=user_input))
            
        return state, config

    def run(self, user_input: str = "", user_feedback: str = "", validate_only: bool = False, code_to_validate: str = "", selected_blueprint: str = None, selected_map: str = None, selected_weather: str = None, auto_correction: bool = True):
        state, config = self._prepare_state(user_input, user_feedback, validate_only, code_to_validate, selected_blueprint, selected_map, selected_weather, auto_correction)
        result = self.app.invoke(state, config)
        return result
    
    def get_conversation_history(self):
        config = {"configurable": {"thread_id": self.thread_id}}
        current_state = self.app.get_state(config)
        
        if current_state.values:
            return current_state.values.get("messages", [])
        return []
    
    def close(self):
        try:
            if self.milvus_client:
                self.milvus_client.close()
        except Exception as e:
            logging.warning(f"Warning during MilvusClient cleanup: {e}")
        
        try:
            if self.generator_agent:
                self.generator_agent.close()
        except Exception as e:
            logging.warning(f"Warning during ComponentGeneratorAgent cleanup: {e}")
        
        try:
            if self.regulation_query_agent:
                self.regulation_query_agent.close()
        except Exception as e:
            logging.warning(f"Warning during RegulationQueryAgent cleanup: {e}")