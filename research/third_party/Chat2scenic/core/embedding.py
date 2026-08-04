from typing import Optional, Union
import torch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import OpenAIEmbeddings
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from .config import get_settings

settings = get_settings()

class EmbeddingModel:
    def __init__(
        self,
        provider: Optional[str] = None,
        model_name: Optional[str] = None,
        device: Optional[str] = None
    ):
        self.provider = (provider or settings.EMBEDDING_PROVIDER or "huggingface").lower()
        self.model_name = model_name or settings.EMBEDDING_MODEL
        self.device = self._get_device(device or settings.DEVICE)
        self.embedding = self._initialize_embedding()

    def _get_device(self, device: Optional[str] = None) -> str:
        if device is not None:
            return device
        
        if torch.cuda.is_available():
            return "cuda"
        else:
            return "cpu"

    def _initialize_embedding(self) -> Union[HuggingFaceEmbeddings, OpenAIEmbeddings, GoogleGenerativeAIEmbeddings]:
        try:
            if self.provider == "openai":
                if not settings.OPENAI_API_KEY:
                    raise ValueError("No OPENAI_API_KEY found in settings")
                return OpenAIEmbeddings(
                    api_key=settings.OPENAI_API_KEY,
                    model=self.model_name
                )
            
            elif self.provider == "google_genai":
                if not settings.GOOGLE_API_KEY:
                    raise ValueError("No GOOGLE_API_KEY found in settings")
                return GoogleGenerativeAIEmbeddings(
                    model=self.model_name,
                    google_api_key=settings.GOOGLE_API_KEY,
                    task_type="RETRIEVAL_DOCUMENT"
                )
            
            elif self.provider == "huggingface":
                return HuggingFaceEmbeddings(
                    model_name=self.model_name,
                    model_kwargs={"device": self.device},
                    encode_kwargs={"normalize_embeddings": True}
                )
            else:
                raise ValueError(f"Unsupported embedding provider: {self.provider}")
                
        except Exception as e:
            raise RuntimeError(f"Failed to initialize {self.provider} embedding model: {str(e)}")

    def close(self):
        if hasattr(self.embedding, 'client'):
            if hasattr(self.embedding.client, 'close'):
                self.embedding.client.close()
            if hasattr(self.embedding.client, 'model'):
                del self.embedding.client.model
        self.embedding = None

