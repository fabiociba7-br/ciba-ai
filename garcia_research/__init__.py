"""Optional local Python research tooling for Garcia."""
from .adapters import GarciaLLMAdapter, LocalPromptAdapter, OpenAIAdapter
from .config import ResearchConfig
from .exceptions import ResearchError, SearchBlockedError
from .models import ResearchReport, ResearchSource
from .orchestrator import LLMClient
from .service import GarciaResearchService

__all__ = [
    "GarciaResearchService", "ResearchConfig", "ResearchReport", "ResearchSource",
    "LLMClient", "LocalPromptAdapter", "OpenAIAdapter", "GarciaLLMAdapter",
    "ResearchError", "SearchBlockedError",
]
