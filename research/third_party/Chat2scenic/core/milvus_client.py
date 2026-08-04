from collections.abc import Collection
from langchain_milvus import BM25BuiltInFunction, Milvus
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter,MarkdownHeaderTextSplitter
from .config import get_settings
from .embedding import EmbeddingModel

import gc
import logging

settings = get_settings()
logger = logging.getLogger(__name__)

class MilvusClient:
    def __init__(self, collection_name: str = settings.MILVUS_COLLECTION, embedding_provider: str = settings.EMBEDDING_PROVIDER, embedding_model_name: str = settings.EMBEDDING_MODEL ):
        try:
            self.embedding_model = EmbeddingModel(provider=embedding_provider, model_name=embedding_model_name)
            self.embedding = self.embedding_model.embedding
        except Exception as e:
            raise

        self.vector_store = Milvus(
            collection_name=collection_name,
            embedding_function=self.embedding,
            builtin_function=BM25BuiltInFunction(input_field_names="text", output_field_names="sparse"),
            connection_args={"uri": settings.MILVUS_URI, "token": settings.MILVUS_TOKEN},
            vector_field=["dense", "sparse"],
        )
        print(self.vector_store.vector_fields)

        self.text_splitter = RecursiveCharacterTextSplitter(['\n## ','\n# ', '\n\n', '\n'])


    def search(self, query: str, ranker_type=settings.RANKER_TYPE, ranker_params=settings.RANKER_PARAMS) -> list[Document]:
        results = self.vector_store.similarity_search(query, k=settings.MAX_CHUNKS, ranker_type=ranker_type, ranker_params=ranker_params)
        return results

    def insert(self, content: str):
        documents = self.split_content(content)
        for doc in documents:
            with open("debug_doc.txt", "a", encoding="utf-8") as f:
                f.write(doc.page_content + "\n\n------------ split----------\n\n")
            print(f"Chunk size: {len(doc.page_content)}")
            self.vector_store.add_documents([doc])
        print(f"Inserted {len(documents)} document")

    def split_content(self, content: str) -> list[Document]:
        return self.text_splitter.create_documents([content])
        # return self.text_splitter.split_text(content)

    def delete(self, ids: list[str]):
        self.vector_store.delete(ids)

    def close(self):
        try:
            if hasattr(self.vector_store, 'client') and hasattr(self.vector_store.client, 'close'):
                self.vector_store.client.close()
            
            if self.embedding_model:
                self.embedding_model.close()
            
            self.embedding_model = None
            self.embedding = None
            self.vector_store = None
            self.text_splitter = None
            gc.collect()
            logger.info("Successfully cleaned up MilvusClient resources")
            
        except Exception as e:
            logger.error(f"Error during MilvusClient cleanup: {e}")


# if __name__ == "__main__":
#     client = MilvusClient(collection_name="documentation_new",  embedding_provider="google_genai", embedding_model_name="models/gemini-embedding-001")
#     results_dense = client.search("behavior", ranker_type="rrf", ranker_params={"k": 5})
#     with open("debug_search_rff_5.txt", "w", encoding="utf-8") as f:
#         for doc in results_dense:
#             f.write(doc.page_content + "\n\n------------ result ----------\n\n")


#     results_dense = client.search("behavior", ranker_type="rrf", ranker_params={"k": 10})
#     with open("debug_search_rff_10.txt", "w", encoding="utf-8") as f:
#         for doc in results_dense:
#             f.write(doc.page_content + "\n\n------------ result ----------\n\n")

#     results_sparse = client.search("behavior", ranker_type="weighted",ranker_params ={ "weights":[0, 1.0]})
#     with open("debug_search_sparse.txt", "w", encoding="utf-8") as f:
#         for doc in results_sparse:
#             print(len(doc.page_content))
#             f.write(doc.page_content + "\n\n------------ result ----------\n\n")

#     results_sparse = client.search("behavior", ranker_type="weighted", ranker_params ={ "weights":[1.0, 0]})
#     with open("debug_search_dense.txt", "w", encoding="utf-8") as f:
#         for doc in results_sparse:
#             print(len(doc.page_content))
#             f.write(doc.page_content + "\n\n------------ result ----------\n\n")

#     results_sparse = client.search("behavior", ranker_type="weighted", ranker_params ={ "weights":[0.5, 0.5]})
#     with open("debug_search_hybrid.txt", "w", encoding="utf-8") as f:
#         for doc in results_sparse:
#             print(len(doc.page_content))
#             f.write(doc.page_content + "\n\n------------ result ----------\n\n")
