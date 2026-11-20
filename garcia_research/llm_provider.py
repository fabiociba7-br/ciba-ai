"""Resilient LLM provider wrapper shared by all Garcia adapters."""
from __future__ import annotations

from typing import Iterator, Protocol

from .resilience import CircuitBreaker, Retrier


class LLMProvider(Protocol):
    def generate(self, prompt: str) -> str: ...


class StreamingLLMProvider(LLMProvider, Protocol):
    @staticmethod
    def _flatten_messages(messages: list[dict[str, str]]) -> str:
        return "\\n".join(
            f"[{message.get('role', 'user')}]\\n{message.get('content', '')}"
            for message in messages
        )

    def generate_messages(self, messages: list[dict[str, str]]) -> str:
        """Use a provider's native role separation when available."""
        self.breaker.before_call()
        native = getattr(self.provider, "generate_messages", None)

        def operation() -> str:
            result = native(messages) if callable(native) else self.provider.generate(
                self._flatten_messages(messages)
            )
            if not isinstance(result, str) or not result.strip():
                raise ValueError("LLM provider returned an empty response.")
            return result

        result = self.retrier.run(operation, on_failure=self.breaker.record_failure)
        self.breaker.record_success()
        return result

    def generate_stream_messages(self, messages: list[dict[str, str]]) -> Iterator[str]:
        """Stream role-separated messages when the provider supports it."""
        native = getattr(self.provider, "generate_stream_messages", None)
        if callable(native):
            yield from self._stream_operation(lambda: native(messages))
            return
        stream = getattr(self.provider, "generate_stream", None)
        if callable(stream):
            yield from self._stream_operation(lambda: stream(self._flatten_messages(messages)))
            return
        yield self.generate_messages(messages)

    def _stream_operation(self, factory) -> Iterator[str]:
        self.breaker.before_call()
        for attempt in range(self.retrier.attempts):
            emitted = False
            try:
                for chunk in factory():
                    if chunk:
                        emitted = True
                        yield chunk
                if not emitted:
                    raise ValueError("LLM provider returned an empty stream.")
                self.breaker.record_success()
                return
            except Exception:
                self.breaker.record_failure()
                if emitted or attempt + 1 >= self.retrier.attempts:
                    raise
                ceiling = min(
                    self.retrier.base_delay_seconds * (2 ** attempt),
                    self.retrier.max_delay_seconds,
                )
                self.retrier.sleep(ceiling * (0.5 + self.retrier.random_value()))

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
