"""Normalize search evidence and create a typed ResearchReport."""
from __future__ import annotations
import logging
import re
from datetime import datetime, timezone
from typing import Any
from .models import ResearchReport, ResearchSource
from .orchestrator import LLMClient, ResearchOrchestrator

logger = logging.getLogger(__name__)

def synthesize_results(raw_data: list[dict[str, Any]], topic: str,
                       llm_client: LLMClient | None = None) -> ResearchReport:
    sources: list[ResearchSource] = []
    seen_urls: set[str] = set()
    for result in raw_data:
        for item in result.get("results", []):
            url = item.get("url")
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append(ResearchSource(
                title=str(item.get("title") or "Untitled source"),
                snippet=str(item.get("snippet") or ""),
                url=url,
                provider=str(item.get("provider") or "DuckDuckGo"),
            ))

    code_snippets = [
        {"source": source.url, "content": source.snippet}
        for source in sources
        if re.search(r"```|\b(curl|SELECT|function|class|import)\b",
                     source.snippet, re.IGNORECASE)
    ]
    executive_summary = (
        f"Collected {len(sources)} unique sources for the topic: {topic}."
        if sources else f"Insufficient search evidence was collected for: {topic}."
    )
    insights: list[str] = []

    if llm_client is not None and sources:
        import json
        evidence = [
            {"title": s.title, "snippet": s.snippet[:1200], "url": s.url}
            for s in sources[:25]
        ]
        prompt = (
            "Synthesize the evidence below. Do not invent claims or sources. Separate "
            "evidence from recommendations and identify uncertainty. "
            f"Topic: {topic}\nEvidence: {json.dumps(evidence, ensure_ascii=False)}\n"
            'Return JSON keys: "executive_summary", "insights", "recommendations", "risks".'
        )
        try:
            parsed = ResearchOrchestrator._parse_json(llm_client.generate(prompt))
            executive_summary = str(parsed.get("executive_summary") or executive_summary)
            insights = [str(x) for x in parsed.get("insights", []) if x]
            insights += [f"Recommendation: {x}" for x in parsed.get("recommendations", []) if x]
            insights += [f"Risk to validate: {x}" for x in parsed.get("risks", []) if x]
        except Exception:
            logger.exception("LLM synthesis failed; retaining source-based summary.")

    if not insights:
        insights = [f"{source.title}: {source.snippet}".strip() for source in sources[:10]]

    return ResearchReport(
        topic=topic,
        generated_at=datetime.now(timezone.utc).isoformat(),
        executive_summary=executive_summary,
        insights=insights,
        sources=sources,
        code_snippets=code_snippets,
    )
