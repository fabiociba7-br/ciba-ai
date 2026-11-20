"""DuckDuckGo HTTP client with conservative rate limiting and caching."""
from __future__ import annotations
import logging
import random
import time
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
import requests
from bs4 import BeautifulSoup
from .config import ResearchConfig
from .exceptions import ResearchError, SearchBlockedError

logger = logging.getLogger(__name__)

class RobustDuckDuckGoClient:
    """Search DuckDuckGo without attempting to evade access controls."""

    def __init__(self, config: ResearchConfig, session: requests.Session | None = None) -> None:
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update({
            "User-Agent": config.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Referer": "https://duckduckgo.com/",
            "Connection": "keep-alive",
        })
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._last_request_at = 0.0

    def close(self) -> None:
        self.session.close()

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        created_at, value = entry
        if time.monotonic() - created_at > self.config.cache_ttl_seconds:
            self._cache.pop(key, None)
            return None
        return value

    def _cache_set(self, key: str, value: dict[str, Any]) -> None:
        self._cache[key] = (time.monotonic(), value)

    def _throttle(self) -> None:
        delay = random.uniform(self.config.request_delay_min, self.config.request_delay_max)
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request_at = time.monotonic()

    def _sleep_backoff(self, attempt: int, retry_after: float | None = None) -> None:
        exponential = min(self.config.backoff_base_seconds * (2 ** attempt),
                          self.config.backoff_max_seconds)
        base = retry_after if retry_after is not None else exponential
        wait = min(max(base + random.uniform(0.0, min(base * 0.25, 2.0)), 0.0),
                   self.config.backoff_max_seconds)
        logger.warning("Search temporarily unavailable; waiting %.1f seconds.", wait)
        time.sleep(wait)

    def _request(self, url: str, params: dict[str, str]) -> requests.Response:
        for attempt in range(self.config.max_retries + 1):
            self._throttle()
            try:
                response = self.session.get(url, params=params,
                                            timeout=self.config.request_timeout_seconds)
            except requests.RequestException as exc:
                if attempt >= self.config.max_retries:
                    raise ResearchError(f"Search request failed: {exc}") from exc
                self._sleep_backoff(attempt)
                continue
            if response.status_code in (401, 403):
                raise SearchBlockedError(
                    f"DuckDuckGo denied the request (HTTP {response.status_code}); "
                    "the client will not bypass the restriction."
                )
            if response.status_code in (429, 503):
                if attempt >= self.config.max_retries:
                    raise SearchBlockedError(
                        f"DuckDuckGo rate-limited the client (HTTP {response.status_code})."
                    )
                try:
                    retry_after = float(response.headers.get("Retry-After", ""))
                except (TypeError, ValueError):
                    retry_after = None
                self._sleep_backoff(attempt, retry_after)
                continue
            if response.status_code >= 500:
                if attempt >= self.config.max_retries:
                    raise ResearchError(
                        f"DuckDuckGo server error persisted (HTTP {response.status_code})."
                    )
                self._sleep_backoff(attempt)
                continue
            try:
                response.raise_for_status()
            except requests.HTTPError as exc:
                raise ResearchError(f"DuckDuckGo HTTP error: {exc}") from exc
            return response
        raise ResearchError("Search retry limit reached.")

    @staticmethod
    def _real_url(href: str | None) -> str | None:
        if not href or "duckduckgo.com/y.js" in href:
            return None
        parsed = urlparse(href)
        if parsed.path.startswith("/l/"):
            href = parse_qs(parsed.query).get("uddg", [None])[0]
            if not href:
                return None
            href = unquote(href)
            parsed = urlparse(href)
        elif href.startswith("//"):
            href = "https:" + href
            parsed = urlparse(href)
        if parsed.scheme not in ("http", "https"):
            return None
        if parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
            return None
        return href

    def search_api(self, query: str) -> dict[str, Any]:
        key = f"api:{query.strip().casefold()}"
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        response = self._request(self.config.ddg_api_url, {
            "q": query, "format": "json", "no_html": "1", "skip_disambig": "1"
        })
        try:
            payload = response.json()
        except ValueError as exc:
            raise ResearchError("DuckDuckGo Instant Answer returned invalid JSON.") from exc
        results: list[dict[str, str]] = []
        if payload.get("AbstractText") and payload.get("AbstractURL"):
            results.append({
                "title": payload.get("Heading") or query,
                "snippet": payload["AbstractText"],
                "url": payload["AbstractURL"],
                "provider": "DuckDuckGo Instant Answer",
            })
        self._collect_related(payload.get("RelatedTopics", []), results)
        result = {"query": query, "mode": "api", "results": results}
        self._cache_set(key, result)
        return result

    @classmethod
    def _collect_related(cls, items: list[dict[str, Any]], output: list[dict[str, str]]) -> None:
        for item in items:
            if isinstance(item.get("Topics"), list):
                cls._collect_related(item["Topics"], output)
                continue
            url = cls._real_url(item.get("FirstURL"))
            text = item.get("Text")
            if url and text:
                output.append({"title": text[:160], "snippet": text, "url": url,
                               "provider": "DuckDuckGo Related Topic"})

    def search_html(self, query: str) -> dict[str, Any]:
        key = f"html:{query.strip().casefold()}"
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        response = self._request(self.config.ddg_html_url, {"q": query})
        soup = BeautifulSoup(response.text, "html.parser")
        page_text = soup.get_text(" ", strip=True).casefold()
        if any(marker in page_text for marker in
               ("captcha", "unusual traffic", "anomaly detected", "automated requests")):
            raise SearchBlockedError("DuckDuckGo returned a CAPTCHA or traffic challenge.")
        results: list[dict[str, str]] = []
        for item in soup.select(".result"):
            anchor = item.select_one(".result__title a")
            if anchor is None:
                continue
            url = self._real_url(anchor.get("href"))
            if not url:
                continue
            snippet = item.select_one(".result__snippet")
            results.append({
                "title": anchor.get_text(" ", strip=True),
                "snippet": snippet.get_text(" ", strip=True) if snippet else "",
                "url": url,
                "provider": "DuckDuckGo HTML",
            })
            if len(results) >= self.config.max_results_per_query:
                break
        result = {"query": query, "mode": "html", "results": results}
        self._cache_set(key, result)
        return result

    def search(self, query: str) -> dict[str, Any]:
        api_result = self.search_api(query)
        if len(api_result["results"]) >= 2:
            return api_result
        html_result = self.search_html(query)
        combined: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in api_result["results"] + html_result["results"]:
            if item["url"] not in seen:
                seen.add(item["url"])
                combined.append(item)
        return {"query": query, "mode": "api+html", "results": combined}
