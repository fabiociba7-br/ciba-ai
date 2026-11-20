"""Resilient LLM provider wrapper shared by all Garcia adapters."""
from __future__ import annotations

from typing import Iterator, Protocol

from .resilience import CircuitBreaker, Retrier


class LLMProvider(Protocol):
    def generate(self, prompt: str) -> str: ...


class StreamingLLMProvider(LLMProvider, Protocol):
    def generate_stream(self, prompt: str) -> Iterator[str]: ...


class ResilientLLMProvider:
    """Apply retry and circuit-breaker policy to an injected provider."""

    def __init__(
        self,
        provider: LLMProvider,
        *,
        breaker: CircuitBreaker | None = None,
        retrier: Retrier | None = None,
    ) -> None:
        self.provider = provider
        self.breaker = breaker or CircuitBreaker()
        self.retrier = retrier or Retrier()

    def generate(self, prompt: str) -> str:
        self.breaker.before_call()
        try:
            result = self.retrier.run(self.provider.generate, on_failure=self.breaker.record_failure)
        except Exception:
            raise
        self.breaker.record_success()
        if not isinstance(result, str) or not result.strip():
            self.breaker.record_failure()
            raise ValueError("LLM provider returned an empty response.")
        return result

    def generate_stream(self, prompt: str) -> Iterator[str]:
        """Stream when supported; otherwise emit the non-streaming response once."""
        self.breaker.before_call()
        stream_method = getattr(self.provider, "generate_stream", None)
        if not callable(stream_method):
            yield self.generate(prompt)
            return
        try:
            chunks = self.retrier.run(lambda: iter(stream_method(prompt)),
                                      on_failure=self.breaker.record_failure)
            emitted = False
            for chunk in chunks:
                if chunk:
                    emitted = True
                    yield chunk
            if not emitted:
                raise ValueError("LLM provider returned an empty stream.")
        except Exception:
            self.breaker.record_failure()
            raise
        self.breaker.record_success()
