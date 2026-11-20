"""Retry, timeout, and circuit-breaker primitives for external dependencies."""
from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Callable, TypeVar

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    """Raised while a dependency circuit is open."""


@dataclass(slots=True)
class CircuitBreaker:
    failure_threshold: int = 3
    reset_timeout_seconds: float = 30.0
    failure_count: int = 0
    opened_at: float | None = None
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        if self.failure_threshold < 1 or self.reset_timeout_seconds < 0:
            raise ValueError("Invalid circuit-breaker configuration.")

    @property
    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        if self.clock() - self.opened_at >= self.reset_timeout_seconds:
            self.opened_at = None
            self.failure_count = 0
            return False
        return True

    def before_call(self) -> None:
        if self.is_open:
            raise CircuitOpenError("The LLM provider circuit is open; retry later.")

    def record_success(self) -> None:
        self.failure_count = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold and self.opened_at is None:
            self.opened_at = self.clock()


class Retrier:
    """Small synchronous retry helper with capped exponential backoff and jitter."""

    def __init__(
        self,
        attempts: int = 3,
        base_delay_seconds: float = 0.25,
        max_delay_seconds: float = 4.0,
        sleep: Callable[[float], None] = time.sleep,
        random_value: Callable[[], float] = random.random,
    ) -> None:
        if attempts < 1 or base_delay_seconds < 0 or max_delay_seconds < 0:
            raise ValueError("Invalid retry configuration.")
        self.attempts = attempts
        self.base_delay_seconds = base_delay_seconds
        self.max_delay_seconds = max_delay_seconds
        self.sleep = sleep
        self.random_value = random_value

    def run(self, operation: Callable[[], T], on_failure: Callable[[], None] | None = None) -> T:
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                return operation()
            except Exception as exc:
                last_error = exc
                if on_failure is not None:
                    on_failure()
                if attempt + 1 >= self.attempts:
                    break
                ceiling = min(self.base_delay_seconds * (2 ** attempt), self.max_delay_seconds)
                self.sleep(ceiling * (0.5 + self.random_value()))
        assert last_error is not None
        raise last_error
