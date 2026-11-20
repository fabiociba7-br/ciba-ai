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

        def operation() -> str:
            result = self.provider.generate(prompt)
            if not isinstance(result, str) or not result.strip():
                raise ValueError("LLM provider returned an empty response.")
            return result

        result = self.retrier.run(operation, on_failure=self.breaker.record_failure)
        self.breaker.record_success()
        return result

    def generate_stream(self, prompt: str) -> Iterator[str]:
        """Stream with retry only before the first token has been emitted."""
        stream_method = getattr(self.provider, "generate_stream", None)
        if not callable(stream_method):
            yield self.generate(prompt)
            return

        self.breaker.before_call()
        for attempt in range(self.retrier.attempts):
            emitted = False
            try:
                for chunk in stream_method(prompt):
                    if chunk:
                        emitted = True
                        yield chunk
                if not emitted:
                    raise ValueError("LLM provider returned an empty stream.")
                self.breaker.record_success()
                return
            except Exception:
                self.breaker.record_failure()
                # Retrying after emitting tokens would duplicate or corrupt output.
                if emitted or attempt + 1 >= self.retrier.attempts:
                    raise
                ceiling = min(
                    self.retrier.base_delay_seconds * (2 ** attempt),
                    self.retrier.max_delay_seconds,
                )
                self.retrier.sleep(ceiling * (0.5 + self.retrier.random_value()))
