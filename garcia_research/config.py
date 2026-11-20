"""Typed configuration for the optional local research CLI."""
from dataclasses import dataclass

@dataclass(slots=True)
class ResearchConfig:
    request_delay_min: float = 2.0
    request_delay_max: float = 4.0
    max_retries: int = 3
    backoff_base_seconds: float = 5.0
    backoff_max_seconds: float = 90.0
    request_timeout_seconds: float = 20.0
    cache_ttl_seconds: int = 43_200
    max_queries: int = 5
    max_results_per_query: int = 8
    user_agent: str = "GarciaResearch/1.0 (security and technology research; configure contact)"
    ddg_api_url: str = "https://api.duckduckgo.com/"
    ddg_html_url: str = "https://html.duckduckgo.com/html/"

    def __post_init__(self) -> None:
        if self.request_delay_min < 0 or self.request_delay_max < self.request_delay_min:
            raise ValueError("Invalid request delay range.")
        if self.max_retries < 0 or self.max_queries < 1 or self.max_results_per_query < 1:
            raise ValueError("Retry and search limits must be valid positive values.")
