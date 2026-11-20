"""Query planning using an injected Garcia LLM adapter when available."""
from __future__ import annotations
import json
import logging
import re
from typing import Protocol
from .config import ResearchConfig

logger = logging.getLogger(__name__)

class LLMClient(Protocol):
    """Minimal adapter contract implemented by local or remote LLM adapters."""
    def generate(self, prompt: str) -> str: ...

class ResearchOrchestrator:
    def __init__(self, config: ResearchConfig, llm_client: LLMClient | None = None) -> None:
        self.config = config
        self.llm_client = llm_client

    @staticmethod
    def _parse_json(text: str) -> dict:
        cleaned = re.sub(r"^\\s*```(?:json)?\\s*|\\s*```\\s*$", "", text)
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end < start:
            raise ValueError("LLM response did not contain a JSON object.")
        return json.loads(cleaned[start:end + 1])

    def generate_queries(
        self, topic: str, depth: str = "standard", focus: list[str] | None = None
    ) -> list[str]:
        budgets = {"quick": 2, "standard": 5, "deep": 8}
        count = min(budgets.get(depth, budgets["standard"]), self.config.max_queries)
        focus_terms = [term.strip() for term in (focus or []) if term.strip()][:8]
        focus_text = ", ".join(focus_terms) if focus_terms else "balanced coverage"
        if self.llm_client is not None:
            prompt = (
                f"Create up to {count} distinct search queries for this security/technology "
                f"topic: {topic!r}. Depth: {depth}. Focus: {focus_text}. Cover standards, "
                "threats, vulnerabilities, mitigations, and implementation guidance. "
                'Return only JSON: {"queries": ["..."]}.'
            )
            try:
                parsed = self._parse_json(self.llm_client.generate(prompt))
                values = parsed.get("queries", [])
                queries = list(dict.fromkeys(
                    value.strip() for value in values
                    if isinstance(value, str) and value.strip()
                ))
                if queries:
                    return queries[:count]
            except Exception:
                logger.exception("LLM query planning failed; using deterministic fallback.")
        base = [
            f"{topic} security architecture and best practices",
            f"{topic} vulnerabilities attack techniques",
            f"{topic} mitigations hardening and detection",
            f"{topic} OWASP NIST standards official documentation",
            f"{topic} secure implementation examples",
            f"{topic} threat model incident analysis",
            f"{topic} security testing audit checklist",
            f"{topic} security advisories CVE",
        ]
        if focus_terms:
            base = [f"{query} {' '.join(focus_terms)}" for query in base]
        return base[:count]
