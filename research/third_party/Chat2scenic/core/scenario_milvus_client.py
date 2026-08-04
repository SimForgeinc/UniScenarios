
from pymilvus import connections, Collection
from .config import get_settings
from .embedding import EmbeddingModel

import logging

settings = get_settings()
logger = logging.getLogger(__name__)


class ScenarioMilvusClient:
    def __init__(self, collection_name: str = "scenario_components"):
        self.collection_name = collection_name
        
        try:
            self.embedding_model = EmbeddingModel()
            self.embedding = self.embedding_model.embedding
        except Exception as e:
            raise
        
        try:
            connections.connect(uri=settings.MILVUS_URI, token=settings.MILVUS_TOKEN)
            self.collection = Collection(collection_name)
            self.collection.load()
            logger.info(f"✅ Successfully connected to collection: {collection_name}")
        except Exception as e:
            logger.error(f"❌ Failed to connect to collection {collection_name}: {e}")
            raise
    
    def search_components_by_type(self, query: str, component_type: str, limit: int = 5) -> list:
        try:
            query_embedding = self.embedding.embed_query(query)
            
            search_params = {
                "metric_type": "COSINE",
                "params": {"nprobe": 10}
            }
            
            results = self.collection.search(
                data=[query_embedding],
                anns_field="embedding",
                param=search_params,
                limit=limit,
                expr=f'component_type == "{component_type}"',
                output_fields=["scenario_id", "component_type", "description", "code"]
            )
            
            if results and len(results[0]) > 0:
                return results[0]
            return []
            
        except Exception as e:
            logger.error(f" ❌ Error in search_components_by_type: {e}")
            raise
    
    def query_component_by_scenario_and_type(self, scenario_id: str, component_type: str) -> dict:
        try:
            expr = f'scenario_id == "{scenario_id}" and component_type == "{component_type}"'
            
            results = self.collection.query(
                expr=expr,
                output_fields=["scenario_id", "component_type", "description", "code"],
                limit=1
            )
            
            if results and len(results) > 0:
                entity = results[0]
                return {
                    "description": entity.get("description", ""),
                    "code": entity.get("code", "")
                }
            return {}
            
        except Exception as e:
            logger.error(f"Error in query_component_by_scenario_and_type: {e}")
            raise
    
    def search_scenario(self, query: str, limit: int = 1) -> list:
        return self.search_components_by_type(query, "Scenario", limit)
    
    def get_all_components_by_scenario_id(self, scenario_id: str) -> dict:
        component_types = [
            "Scenario",
            "Spatial Relation",
            "Requirement and restrictions"
        ]
        
        components = {}
        
        for component_type in component_types:
            try:
                component = self.query_component_by_scenario_and_type(scenario_id, component_type)
                if component:
                    component["scenario_id"] = scenario_id
                    components[component_type] = component
            except Exception as e:
                logger.warning(f"Failed to retrieve {component_type} for scenario {scenario_id}: {e}")
        
        try:
            component = self.query_component_by_scenario_and_type(scenario_id, "Ego")
            if component:
                component["scenario_id"] = scenario_id
                components["Ego"] = component
        except Exception as e:
            logger.warning(f"Failed to retrieve Ego for scenario {scenario_id}: {e}")
        
        try:
            expr = f'scenario_id == "{scenario_id}" and component_type == "Adversarial"'
            results = self.collection.query(
                expr=expr,
                output_fields=["scenario_id", "component_type", "description", "code"],
                limit=100
            )
            
            if results:
                components["Adversarials"] = []
                for entity in results:
                    components["Adversarials"].append({
                        "description": entity.get("description", ""),
                        "code": entity.get("code", ""),
                        "scenario_id": scenario_id
                    })
        except Exception as e:
            logger.warning(f"Failed to retrieve Adversarials for scenario {scenario_id}: {e}")
        
        return components
    
    def close(self):
        try:
            if self.collection:
                self.collection.release()
            
            connections.disconnect("default")
            
            if self.embedding_model:
                self.embedding_model.close()
            
            self.collection = None
            self.embedding_model = None
            self.embedding = None
            
            logger.info("Successfully closed ScenarioMilvusClient")
            
        except Exception as e:
            logger.error(f"Error closing ScenarioMilvusClient: {e}")

