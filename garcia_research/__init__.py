"""Optional local Python research tooling for Garcia."""
from .adapters import GarciaLLMAdapter, LocalPromptAdapter, OpenAIAdapter
from .assistant import GarciaResearchAssistant
from .config import ResearchConfig
from .exceptions import ResearchError, SearchBlockedError
from .engine import EngineConfig, GarciaEngine, StreamEvent
from .llm_provider import ResilientLLMProvider
from .resilience import CircuitBreaker, CircuitOpenError, Retrier
from .models import ResearchReport, ResearchSource
from .orchestrator import LLMClient
from .service import GarciaResearchService

__all__ = [
    "GarciaResearchService", "GarciaResearchAssistant", "ResearchConfig", "ResearchReport", "ResearchSource",
    "LLMClient", "LocalPromptAdapter", "OpenAIAdapter", "GarciaLLMAdapter",
    "ResearchError", "SearchBlockedError", "GarciaEngine", "EngineConfig",
    "StreamEvent", "ResilientLLMProvider", "CircuitBreaker", "CircuitOpenError", "Retrier",
]
