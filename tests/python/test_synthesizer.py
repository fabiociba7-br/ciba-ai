from garcia_research.models import ResearchReport
from garcia_research.synthesizer import synthesize_results

def test_synthesizer_deduplicates_and_returns_dataclass():
    raw = [{"results": [
        {"title": "OAuth guidance", "snippet": "Use PKCE.", "url": "https://example.org/a"},
        {"title": "Duplicate", "snippet": "Duplicate.", "url": "https://example.org/a"},
        {"title": "OWASP", "snippet": "Use curl for tests.", "url": "https://example.org/b"},
    ]}]
    report = synthesize_results(raw, "OAuth2 security")
    assert isinstance(report, ResearchReport)
    assert report.topic == "OAuth2 security"
    assert len(report.sources) == 2
    assert report.sources[0].title == "OAuth guidance"
    assert report.code_snippets[0]["source"] == "https://example.org/b"

def test_synthesizer_handles_empty_results():
    report = synthesize_results([], "empty topic")
    assert report.sources == []
    assert report.insights == []
    assert "Insufficient" in report.executive_summary
