"""Public API for the optional local research CLI."""
from __future__ import annotations
import logging
from .client import RobustDuckDuckGoClient
from .config import ResearchConfig
from .exceptions import ResearchError, SearchBlockedError
from .models import ResearchReport
from .orchestrator import LLMClient, ResearchOrchestrator
from .synthesizer import synthesize_results

logger = logging.getLogger(__name__)

class GarciaResearchService:
    """Local research helper. Persistent artifacts are handled by the Cloudflare Worker."""
    def __init__(self, config: ResearchConfig, llm_client: LLMClient | None = None) -> None:
        self.config = config
        self.llm_client = llm_client
        self.search_client = RobustDuckDuckGoClient(config)
        self.orchestrator = ResearchOrchestrator(config, llm_client)

    def run(self, topic: str, depth: str = "standard", focus: list[str] | None = None) -> ResearchReport:
        topic = topic.strip()
        if not topic:
            raise ValueError("topic must not be empty.")
        if depth not in {"quick", "standard", "deep"}:
            raise ValueError("depth must be quick, standard, or deep.")
        focus_terms = [term.strip() for term in (focus or []) if term.strip()][:8]
        queries = self.orchestrator.generate_queries(topic, depth=depth, focus=focus_terms)
        raw_data = []
        for query in queries:
            try:
                raw_data.append(self.search_client.search(query))
            except SearchBlockedError:
                logger.exception("Search provider blocked the research run.")
                if not raw_data:
                    raise
                break
            except ResearchError:
                logger.exception("Search query failed; continuing.")
        if not raw_data:
            raise ResearchError("No search results were collected.")
        report = synthesize_results(raw_data, topic, self.llm_client)
        report.queries = queries
        return report

    def close(self) -> None:
        self.search_client.close()

    def __enter__(self) -> "GarciaResearchService":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()
