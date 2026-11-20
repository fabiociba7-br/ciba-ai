"""LLM adapters for research planning and evidence synthesis.

The default adapter is entirely local and makes no network calls. Network-backed
adapters are opt-in and implement the same generate(prompt) -> str contract.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import requests


class LocalPromptAdapter:
    """Deterministic prompt adapter; suitable for offline/out-of-the-box use."""

    def generate(self, prompt: str) -> str:
        lowered = prompt.casefold()
        if "evidence:" in lowered and "executive_summary" in lowered:
            return self._synthesize(prompt)
        return self._plan_queries(prompt)

    @staticmethod
    def _plan_queries(prompt: str) -> str:
        match = re.search(r"topic:\s*['\"](.+?)['\"]", prompt, re.IGNORECASE)
        topic = match.group(1) if match else prompt.strip()
        focus_match = re.search(r"focus:\s*([^.]+)", prompt, re.IGNORECASE)
        focus = focus_match.group(1).strip() if focus_match else ""
        suffix = f" {focus}" if focus else ""
        queries = [
            f"{topic}{suffix} security architecture and best practices",
            f"{topic}{suffix} vulnerabilities attack techniques",
            f"{topic}{suffix} mitigations hardening and detection",
            f"{topic}{suffix} OWASP NIST standards official documentation",
            f"{topic}{suffix} secure implementation examples",
            f"{topic}{suffix} incident analysis threat model",
            f"{topic}{suffix} testing audit checklist",
            f"{topic}{suffix} recent security advisories CVE",
        ]
        count_match = re.search(r"up to (\d+)", prompt, re.IGNORECASE)
        count = int(count_match.group(1)) if count_match else 5
        return json.dumps({"queries": queries[:max(1, min(count, 8))]}, ensure_ascii=False)

    @staticmethod
    def _synthesize(prompt: str) -> str:
        evidence: list[dict[str, Any]] = []
        marker = re.search(r"Evidence:\s*", prompt, re.IGNORECASE)
        if marker:
            try:
                decoder = json.JSONDecoder()
                parsed, _ = decoder.raw_decode(prompt[marker.end():].lstrip())
                if isinstance(parsed, list):
                    evidence = [item for item in parsed if isinstance(item, dict)]
            except (json.JSONDecodeError, TypeError):
                evidence = []
        insights = []
        for item in evidence[:12]:
            title = str(item.get("title") or "Untitled source").strip()
            snippet = str(item.get("snippet") or "").strip()
            if snippet:
                insights.append(f"{title}: {snippet}")
        summary = (
            f"Local synthesis reviewed {len(evidence)} source(s). "
            "Validate each finding against the linked primary sources before acting."
            if evidence else
            "No parseable source evidence was provided. No security conclusion is asserted."
        )
        return json.dumps({
            "executive_summary": summary,
            "insights": insights,
            "recommendations": [
                "Prioritize primary vendor advisories, standards, and maintained project documentation.",
                "Reproduce security-relevant claims in an isolated test environment before remediation."
            ] if evidence else [],
            "risks": ["Search snippets may be incomplete, outdated, or lack sufficient context."]
        }, ensure_ascii=False)


class OpenAIAdapter:
    """OpenAI Chat Completions adapter using an explicit API key."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o-mini",
        timeout_seconds: float = 45.0,
    ) -> None:
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required for OpenAIAdapter.")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()

    def generate(self, prompt: str) -> str:
        response = self.session.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json"},
            json={"model": self.model, "temperature": 0.2,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return payload["choices"][0]["message"]["content"]


class GarciaLLMAdapter:
    """Adapter for a future authenticated Garcia HTTP inference endpoint.

    Expected endpoint contract: POST JSON {"prompt": "..."} and response
    JSON containing a string field "text" or "output". This deliberately
    does not assume an internal Garcia URL.
    """

    def __init__(
        self,
        endpoint: str,
        token: str | None = None,
        timeout_seconds: float = 45.0,
    ) -> None:
        if not endpoint.startswith("https://"):
            raise ValueError("Garcia LLM endpoint must use HTTPS.")
        self.endpoint = endpoint
        self.token = token or os.getenv("GARCIA_LLM_TOKEN")
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()

    def generate(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        response = self.session.post(
            self.endpoint, headers=headers, json={"prompt": prompt},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        text = payload.get("text", payload.get("output"))
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Garcia LLM endpoint returned no text/output string.")
        return text
