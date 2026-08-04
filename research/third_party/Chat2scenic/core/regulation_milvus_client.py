
from pymilvus import connections, Collection
from .config import get_settings
from .embedding import EmbeddingModel

import logging

settings = get_settings()
logger = logging.getLogger(__name__)


class RegulationMilvusClient:
    def __init__(self, collection_name: str = "regulations"):
        self.collection_name = collection_name
        
        try:
            self.embedding_model = EmbeddingModel(model_name="BAAI/bge-large-en-v1.5")
            self.embedding = self.embedding_model.embedding
        except Exception as e:
            logger.error(f"❌ Failed to initialize embedding model: {e}")
            raise
        
        try:
            connections.connect(uri=settings.MILVUS_URI, token=settings.MILVUS_TOKEN)
            self.collection = Collection(collection_name)
            self.collection.load()
            logger.info(f"✅ Successfully connected to regulations collection: {collection_name}")
        except Exception as e:
            logger.error(f"❌ Failed to connect to collection {collection_name}: {e}")
            raise
    
    def search(self, query: str, limit: int = 5, regulation_filter: str = None) -> list:
        try:
            query_embedding = self.embedding.embed_query(query)
            
            search_params = {
                "metric_type": "COSINE",
                "params": {"nprobe": 10}
            }
            
            expr = None
            if regulation_filter:
                expr = f'regulation_id == "{regulation_filter}"'
            
            results = self.collection.search(
                data=[query_embedding],
                anns_field="embedding",
                param=search_params,
                limit=limit,
                expr=expr,
                output_fields=["regulation_id", "section", "chunk_index", "content"]
            )
            
            if results and len(results[0]) > 0:
                search_results = []
                for hit in results[0]:
                    search_results.append({
                        "regulation_id": hit.entity.get("regulation_id", ""),
                        "section": hit.entity.get("section", ""),
                        "chunk_index": hit.entity.get("chunk_index", 0),
                        "content": hit.entity.get("content", ""),
                        "score": float(hit.score)
                    })
                return search_results
            return []
            
        except Exception as e:
            logger.error(f"❌ Error in regulation search: {e}")
            raise
    
    def search_by_regulation(self, query: str, regulation_id: str, limit: int = 5) -> list:
        return self.search(query, limit, regulation_filter=regulation_id)
    
    def search_benchmark_scenarios(self, query: str, limit: int = 10) -> list:
        return self.search(query, limit, regulation_filter="BENCHMARK")
    
    def get_available_regulations(self) -> list:
        try:
            # Query to get distinct regulation IDs
            results = self.collection.query(
                expr="regulation_id != ''",
                output_fields=["regulation_id"],
                limit=1000
            )
            
            regulation_ids = set()
            for r in results:
                reg_id = r.get("regulation_id", "")
                if reg_id:
                    regulation_ids.add(reg_id)
            
            return sorted(list(regulation_ids))
            
        except Exception as e:
            logger.error(f"❌ Error getting available regulations: {e}")
            return []
    
    def get_sections_for_regulation(self, regulation_id: str) -> list:
        try:
            results = self.collection.query(
                expr=f'regulation_id == "{regulation_id}"',
                output_fields=["section"],
                limit=1000
            )
            
            sections = set()
            for r in results:
                section = r.get("section", "")
                if section:
                    sections.add(section)
            
            return sorted(list(sections))
            
        except Exception as e:
            logger.error(f"❌ Error getting sections: {e}")
            return []
    
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
            
            logger.info("Successfully closed RegulationMilvusClient")
            
        except Exception as e:
            logger.error(f"Error closing RegulationMilvusClient: {e}")
