from garcia_research.assistant import GarciaResearchAssistant
from garcia_research.engine import EngineConfig


class FakeRetriever:
    def __init__(self):
        self.calls = []

    def run(self, topic, **kwargs):
        self.calls.append((topic, kwargs))
        return {"sources": [{"title": "Primary Source", "snippet": "Verified evidence."}]}


class FakeLLM:
    def generate(self, prompt):
        return (
            '{"raciocinio":"The source supports the conclusion.",'
            '"resposta":"Use the documented control.",'
            '"fontes":["Primary Source"],"confianca":0.88,"lacunas":[]}'
        )


def test_assistant_facade_connects_retrieval_and_cognitive_engine():
    retriever = FakeRetriever()
    assistant = GarciaResearchAssistant(
        FakeLLM(),
        retriever=retriever,
        engine_config=EngineConfig(max_iterations=1),
    )

    result = assistant.ask("security review", depth="deep", focus=["PKCE"])

    assert result["confianca"] == 0.88
    assert retriever.calls[0][1] == {"depth": "deep", "focus": ["PKCE"]}
    assistant.close()
