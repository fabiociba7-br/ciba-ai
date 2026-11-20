"""Optional Python research tooling for Garcia."""
from .adapters import GarciaLLMAdapter, LocalPromptAdapter, OpenAIAdapter
from .config import ResearchConfig
from .exceptions import GitPublisherError, ResearchError, SearchBlockedError
from .models import PublishResult, ResearchReport, ResearchSource
from .orchestrator import LLMClient
from .service import GarciaResearchService

__all__ = [
    "GarciaResearchService", "ResearchConfig", "ResearchReport",
    "ResearchSource", "PublishResult", "LLMClient", "LocalPromptAdapter",
    "OpenAIAdapter", "GarciaLLMAdapter", "ResearchError",
    "SearchBlockedError", "GitPublisherError",
]
