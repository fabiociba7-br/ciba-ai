"""Typed configuration for the Garcia research package."""
from dataclasses import dataclass
from pathlib import Path

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
    reports_dir: str = "reports/research"
    repo_path: Path | str | None = None
    branch: str = "main"
    remote: str = "origin"
    publish_enabled: bool = False
    user_agent: str = "GarciaResearch/1.0 (security and technology research; configure contact)"
    ddg_api_url: str = "https://api.duckduckgo.com/"
    ddg_html_url: str = "https://html.duckduckgo.com/html/"

    def __post_init__(self) -> None:
        if self.request_delay_min < 0 or self.request_delay_max < self.request_delay_min:
            raise ValueError("Invalid request delay range.")
        if self.max_retries < 0 or self.max_queries < 1 or self.max_results_per_query < 1:
            raise ValueError("Retry and search limits must be valid positive values.")
        if not self.branch.strip() or not self.remote.strip():
            raise ValueError("Git branch and remote must be non-empty.")
        if self.repo_path is not None:
            self.repo_path = Path(self.repo_path)
