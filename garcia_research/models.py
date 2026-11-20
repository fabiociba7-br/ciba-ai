"""Typed public models returned by the research service."""
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass(slots=True)
class ResearchSource:
    title: str
    snippet: str
    url: str
    provider: str = "DuckDuckGo"

@dataclass(slots=True)
class PublishResult:
    status: str
    message: str = ""
    markdown_path: str | None = None
    json_path: str | None = None
    branch: str | None = None
    commit: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

@dataclass(slots=True)
class ResearchReport:
    topic: str
    generated_at: str
    executive_summary: str
    insights: list[str] = field(default_factory=list)
    sources: list[ResearchSource] = field(default_factory=list)
    code_snippets: list[dict[str, str]] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    publication: PublishResult | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
