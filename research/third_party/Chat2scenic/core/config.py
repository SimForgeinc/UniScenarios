from pydantic_settings import BaseSettings
from functools import lru_cache
import torch


class Settings(BaseSettings):
    #  Milvus
    MILVUS_URI: str = "http://localhost:19530"
    MILVUS_COLLECTION: str = "documentation" 
    MILVUS_TOKEN: str = ""

    MISTRAL_OCR_KEY: str = ""

    #  Embeddings
    EMBEDDING_PROVIDER: str = "huggingface"  # "huggingface" or "openai", "google_genai"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"

    #  Device
    DEVICE: str = "cuda" if torch.cuda.is_available() else "cpu"
    print("using device: " ,DEVICE)

    #  Chunking
    MAX_CHUNKS: int = 10 
    CHUNK_SIZE: int = 2000
    CHUNK_OVERLAP: int = 400

    RANKER_TYPE: str = "rrf"
    RANKER_PARAMS: dict = {"k": 60}  

    #  Ollama
    OLLAMA_URL: str = "http://localhost:11434"
    LLM_MODEL_NAME: str =  "gemini-3.5-flash"


    # keys
    OPENAI_API_KEY: str | None = None
    GOOGLE_API_KEY: str | None = None
    DEEPSEEK_API_KEY: str | None = None
    QWEN_API_KEY: str | None = None

    
    #  LLM Response Parameters
    LLM_PROVIDER: str = "google_genai"  # "ollama" or "openai" or "google_genai"
    LLM_TEMPERATURE: float = 0.0  # Controls creativity/randomness (0.0-1.0)
    LLM_MAX_TOKENS: int = 4096    # Maximum response length
    LLM_TOP_P: float = 0.9        # Nucleus sampling parameter
    LLM_TOP_K: int = 40           # Top-k sampling parameter

    class Config:
        env_file = "././.env"   


@lru_cache()
def get_settings():
    return Settings()
