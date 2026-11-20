"""Query planning using an injected Garcia LLM adapter when available."""
from __future__ import annotations
import json
import logging
import re
from typing import Protocol
from .config import ResearchConfig

logger = logging.getLogger(__name__)

class LLMClient(Protocol):
    """Minimal adapter contract implemented by an existing LLM service."""
    def generate(self, prompt: str) -> str: ...

class ResearchOrchestrator:
    def __init__(self, config: ResearchConfig, llm_client: LLMClient | None = None) -> None:
        self.config = config
        self.llm_client = llm_client

    @staticmethod
    def _parse_json(text: str) -> dict:
        cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text)
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end < start:
            raise ValueError("LLM response did not contain a JSON object.")
        return json.loads(cleaned[start:end + 1])

    def generate_queries(self, topic: str) -> list[str]:
        if self.llm_client is not None:
            prompt = (
                f"Create up to {self.config.max_queries} distinct search queries for "
                f"this security/technology topic: {topic!r}. Cover standards, threats, "
                'vulnerabilities, mitigations and implementation guidance. Return JSON: '
                '{"queries": ["..."]}.'
            )
            try:
                parsed = self._parse_json(self.llm_client.generate(prompt))
                values = parsed.get("queries", [])
                queries = list(dict.fromkeys(
                    value.strip() for value in values
                    if isinstance(value, str) and value.strip()
                ))
                if queries:
                    return queries[:self.config.max_queries]
            except Exception:
                logger.exception("LLM query planning failed; using deterministic fallback.")
        return [
            f"{topic} security best practices",
            f"{topic} vulnerabilities attack vectors",
            f"{topic} mitigation hardening guidance",
            f"{topic} OWASP NIST standards",
            f"{topic} technical documentation implementation",
        ][:self.config.max_queries]
