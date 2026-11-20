"""High-level entry point for Garcia's optional local Python research flow."""
from __future__ import annotations

from typing import Any, Iterator

from .config import ResearchConfig
from .engine import EngineConfig, GarciaEngine, StreamEvent
from .service import GarciaResearchService


class GarciaResearchAssistant:
    """Compose local retrieval and the cognitive engine behind one small API.

    This facade is for local development, evaluation, and offline integration
    tests. The Cloudflare Worker remains the production runtime and does not
    import or execute this Python package.
    """

    def __init__(
        self,
        llm_provider: Any,
        *,
        research_config: ResearchConfig | None = None,
        engine_config: EngineConfig | None = None,
        retriever: Any | None = None,
    ) -> None:
        self._owned_service: GarciaResearchService | None = None
        if retriever is None:
            self._owned_service = GarciaResearchService(research_config or ResearchConfig())
            retriever = self._owned_service
        self.engine = GarciaEngine(
            llm_provider=llm_provider,
            retriever=retriever,
            config=engine_config,
        )

    def ask(self, query: str, *, depth: str = "standard",
            focus: list[str] | None = None) -> dict[str, Any]:
        """Run the complete retrieve -> reason -> validate -> refine flow."""
        return self.engine.generate_robust(query, depth=depth, focus=focus or [])

    def stream(self, query: str, *, depth: str = "standard",
               focus: list[str] | None = None) -> Iterator[StreamEvent]:
        """Yield provisional events and one validated final event."""
        return self.engine.generate_stream(query, depth=depth, focus=focus or [])

    def close(self) -> None:
        if self._owned_service is not None:
            self._owned_service.close()
            self._owned_service = None

    def __enter__(self) -> "GarciaResearchAssistant":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()
