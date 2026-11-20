import json
from garcia_research.adapters import LocalPromptAdapter
from garcia_research.config import ResearchConfig
from garcia_research.orchestrator import ResearchOrchestrator

def test_local_adapter_generates_bounded_query_list_with_focus():
    adapter = LocalPromptAdapter()
    orchestrator = ResearchOrchestrator(
        ResearchConfig(max_queries=2), llm_client=adapter
    )
    queries = orchestrator.generate_queries(
        "OAuth2 flows", depth="deep", focus=["PKCE", "redirect_uri"]
    )
    assert len(queries) == 2
    assert all("OAuth2 flows" in query for query in queries)
    assert all("PKCE redirect_uri" in query for query in queries)

def test_local_adapter_synthesizes_evidence_without_network():
    adapter = LocalPromptAdapter()
    prompt = (
        "Synthesize evidence. Topic: OAuth2\nEvidence: "
        + json.dumps([{"title": "RFC", "snippet": "Use PKCE.", "url": "https://example.org"}])
        + '\nReturn JSON keys: "executive_summary", "insights".'
    )
    result = json.loads(adapter.generate(prompt))
    assert "1 source" in result["executive_summary"]
    assert any("Use PKCE" in item for item in result["insights"])


def test_local_adapter_streams_deterministic_chunks():
    adapter = LocalPromptAdapter()
    output = "".join(adapter.generate_stream("Create a short deterministic answer"))
    assert output == adapter.generate("Create a short deterministic answer")


def test_openai_adapter_parses_sse_stream():
    from unittest.mock import Mock
    from garcia_research.adapters import OpenAIAdapter

    adapter = OpenAIAdapter(api_key="test-key")
    response = Mock()
    response.iter_lines.return_value = [
        'data: {"choices":[{"delta":{"content":"Hello "}}]}',
        'data: {"choices":[{"delta":{"content":"Garcia"}}]}',
        "data: [DONE]",
    ]
    adapter.session = Mock()
    adapter.session.post.return_value = response

    assert "".join(adapter.generate_stream("prompt")) == "Hello Garcia"
    response.close.assert_called_once()
