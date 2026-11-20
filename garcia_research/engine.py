"""Garcia Loop: evidence retrieval, structured generation, and iterative correction."""
from __future__ import annotations

import json
import logging
from html import unescape
import re
import time
from dataclasses import asdict, dataclass
from typing import Any, Iterator, Protocol

from .exceptions import ResearchError
from .llm_provider import LLMProvider, ResilientLLMProvider
from .prompts import build_refinement_prompt, build_response_messages
from .resilience import CircuitOpenError, Retrier

logger = logging.getLogger(__name__)

REQUIRED_KEYS = {"raciocinio", "resposta", "fontes", "confianca", "lacunas"}


class Retriever(Protocol):
    def run(self, topic: str, **kwargs: Any) -> Any: ...


@dataclass(slots=True)
class EngineConfig:
    max_iterations: int = 2
    min_confidence: float = 0.7
    max_gaps: int = 2
    max_context_chars: int = 18_000
    retrieval_attempts: int = 3
    retry_base_seconds: float = 0.25
    retry_max_seconds: float = 4.0

    def __post_init__(self) -> None:
        if self.max_iterations < 1:
            raise ValueError("max_iterations must be at least 1.")
        if not 0.0 <= self.min_confidence <= 1.0:
            raise ValueError("min_confidence must be between 0 and 1.")
        if self.max_gaps < 0 or self.max_context_chars < 512 or self.retrieval_attempts < 1:
            raise ValueError("Invalid engine limits.")


@dataclass(slots=True)
class StreamEvent:
    """Typed stream event. Token events are provisional until a final event arrives."""
    event: str
    data: str | dict[str, Any]


class GarciaEngine:
    def __init__(
        self,
        llm_provider: LLMProvider | ResilientLLMProvider,
        retriever: Retriever,
        config: EngineConfig | None = None,
        *,
        retriever_retrier: Retrier | None = None,
    ) -> None:
        self.config = config or EngineConfig()
        self.llm = (llm_provider if isinstance(llm_provider, ResilientLLMProvider)
                    else ResilientLLMProvider(llm_provider))
        self.retriever = retriever
        self.retriever_retrier = retriever_retrier or Retrier(
            attempts=self.config.retrieval_attempts,
            base_delay_seconds=self.config.retry_base_seconds,
            max_delay_seconds=self.config.retry_max_seconds,
        )

    @staticmethod
    def _validate_response(response: dict[str, Any], *, min_confidence: float = 0.7,
                           max_gaps: int = 2) -> bool:
        if not REQUIRED_KEYS.issubset(response):
            return False
        answer = response.get("resposta")
        confidence = response.get("confianca")
        gaps = response.get("lacunas")
        sources = response.get("fontes")
        rationale = response.get("raciocinio")
        if not isinstance(answer, str) or not answer.strip():
            return False
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            return False
        if not 0.0 <= float(confidence) <= 1.0 or float(confidence) < min_confidence:
            return False
        if not isinstance(gaps, list) or len(gaps) > max_gaps:
            return False
        if not all(isinstance(item, str) and item.strip() for item in gaps):
            return False
        if not isinstance(sources, list) or not all(isinstance(item, str) for item in sources):
            return False
        if not isinstance(rationale, str) or not rationale.strip():
            return False
        return True

    @staticmethod
    def _parse_response(raw: str) -> dict[str, Any]:
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^\`\`\`(?:json)?\s*|\s*\`\`\`$", "", text,
                          flags=re.IGNORECASE)
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("LLM output is not valid JSON.") from exc
        if not isinstance(value, dict):
            raise ValueError("LLM output must be a JSON object.")
        return value

    def _sanitize_context(self, context: str) -> str:
        """Bound and XML-escape retrieved text; it remains untrusted evidence."""
        # Redact common instruction-like payloads before delimiter escaping.
        neutralized = re.sub(
            r"(?i)ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|"
            r"disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|"
            r"reveal\s+(?:the\s+)?(?:system|developer)\s+prompt|"
            r"you\s+are\s+now\s+(?:the|a)\b|"
            r"act\s+as\s+(?:the|a)\b",
            "[INSTRUCTION-LIKE TEXT REDACTED]",
            context,
        )
        output: list[str] = []
        size = 0
        replacements = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}
        for char in neutralized:
            if char not in "\n\r\t" and (ord(char) < 32 or ord(char) == 127):
                continue
            escaped = replacements.get(char, char)
            if size + len(escaped) > self.config.max_context_chars:
                break
            output.append(escaped)
            size += len(escaped)
        # Count the escaped representation so the actual prompt budget is bounded.
        return "".join(output)

    @staticmethod
    def _context_from_retrieval(result: Any) -> str:
        if hasattr(result, "to_dict"):
            result = result.to_dict()
        elif hasattr(result, "__dataclass_fields__"):
            result = asdict(result)
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            return json.dumps(result, ensure_ascii=False, default=str)
        return json.dumps(result, ensure_ascii=False, default=str)

    @staticmethod
    def _error_response(message: str, gap: str) -> dict[str, Any]:
        return {
            "raciocinio": message,
            "resposta": "Não foi possível produzir uma resposta confiável neste momento.",
            "fontes": [],
            "confianca": 0.0,
            "lacunas": [gap],
        }

    def _retrieve(self, query: str, **kwargs: Any) -> str:
        result = self.retriever_retrier.run(lambda: self.retriever.run(query, **kwargs))
        return self._sanitize_context(self._context_from_retrieval(result))

    @staticmethod
    def _ground_sources(candidate: dict[str, Any], context: str) -> dict[str, Any]:
        """Discard model-invented source titles not present in retrieved evidence."""
        titles: set[str] = set()
        try:
            payload = json.loads(context)
        except (json.JSONDecodeError, TypeError):
            payload = None

        def collect(value: Any) -> None:
            if isinstance(value, dict):
                title = value.get("title")
                if isinstance(title, str) and title.strip():
                    titles.add(unescape(title.strip()))
                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        collect(payload)
        supplied = candidate.get("fontes", [])
        if not isinstance(supplied, list):
            supplied = []
        grounded = [title for title in supplied
                    if isinstance(title, str) and title.strip() in titles]
        result = dict(candidate)
        result["fontes"] = grounded
        if supplied and not grounded:
            gaps = result.get("lacunas", [])
            if not isinstance(gaps, list):
                gaps = []
            result["lacunas"] = gaps + ["Nenhum título de fonte citado corresponde às fontes recuperadas."]
            result["confianca"] = 0.0
        return result

    def _refine(self, query: str, response: dict[str, Any]) -> str:
        gaps = response.get("lacunas", [])
        if not isinstance(gaps, list):
            gaps = []
        valid_gaps = [gap for gap in gaps if isinstance(gap, str) and gap.strip()]
        if not valid_gaps:
            valid_gaps = ["fontes primárias e evidências verificáveis para elevar a confiança"]
        return build_refinement_prompt(query, valid_gaps[:8])

    def generate_robust(self, query: str, **kwargs: Any) -> dict[str, Any]:
        query = query.strip()
        if not query:
            return self._error_response("A consulta está vazia.", "Consulta técnica não informada.")
        if len(query) > 1_000:
            return self._error_response("A consulta excede o limite permitido.", "Reduza a consulta para até 1.000 caracteres.")
        current_query = query
        last_response: dict[str, Any] | None = None
        try:
            for iteration in range(1, self.config.max_iterations + 1):
                context = self._retrieve(current_query, **kwargs)
                messages = build_response_messages(current_query, context, iteration,
                                                    self.config.max_iterations, context_is_sanitized=True)
                raw = self.llm.generate_messages(messages)
                try:
                    candidate = self._parse_response(raw)
                except ValueError as exc:
                    candidate = {
                        "raciocinio": "A saída do modelo não respeitou o contrato JSON.",
                        "resposta": "",
                        "fontes": [],
                        "confianca": 0.0,
                        "lacunas": [str(exc)],
                    }
                candidate = self._ground_sources(candidate, context)
                last_response = candidate
                if self._validate_response(candidate, min_confidence=self.config.min_confidence,
                                           max_gaps=self.config.max_gaps):
                    return self._normalize(candidate)
                if iteration < self.config.max_iterations:
                    current_query = self._refine(current_query, candidate)
            if last_response is None:
                return self._error_response("Nenhuma resposta foi produzida.", "Falha de geração.")
            normalized = self._normalize(last_response)
            normalized["raciocinio"] = (
                "A validação identificou evidência insuficiente ou campos incompletos; "
                "a resposta abaixo deve ser tratada como inconclusiva. "
                + str(normalized["raciocinio"])
            )
            normalized["confianca"] = min(float(normalized["confianca"]), 0.69)
            return normalized
        except CircuitOpenError:
            return self._error_response(
                "O provedor de linguagem está temporariamente indisponível após falhas consecutivas.",
                "Aguardar a recuperação do provedor e tentar novamente.",
            )
        except Exception as exc:
            logger.exception("Garcia Loop failed.")
            if self.llm.breaker.is_open:
                return self._error_response(
                    "O provedor de linguagem falhou repetidamente e foi temporariamente isolado.",
                    "Aguardar o circuit breaker liberar uma nova tentativa.",
                )
            return self._error_response(
                "A execução foi interrompida por uma falha controlada na recuperação ou geração.",
                f"Falha operacional: {type(exc).__name__}.",
            )

    @staticmethod
    def _normalize(candidate: dict[str, Any]) -> dict[str, Any]:
        confidence = candidate.get("confianca", 0.0)
        try:
            normalized_confidence = float(confidence) if not isinstance(confidence, bool) else 0.0
        except (TypeError, ValueError):
            normalized_confidence = 0.0
        sources = candidate.get("fontes", [])
        gaps = candidate.get("lacunas", [])
        return {
            "raciocinio": candidate.get("raciocinio") if isinstance(candidate.get("raciocinio"), str)
                else "Justificativa não fornecida.",
            "resposta": candidate.get("resposta") if isinstance(candidate.get("resposta"), str) else "",
            "fontes": [item for item in sources if isinstance(item, str)] if isinstance(sources, list) else [],
            "confianca": max(0.0, min(1.0, normalized_confidence)),
            "lacunas": [item for item in gaps if isinstance(item, str)] if isinstance(gaps, list) else [],
        }

    def generate_stream(self, query: str, **kwargs: Any) -> Iterator[StreamEvent]:
        """Stream provisional tokens, with reset events when an iteration is rejected.

        Consumers should display token events provisionally and commit the content
        only after receiving a final event. A reset event clears the prior draft.
        """
        query = query.strip()
        if not query:
            yield StreamEvent("final", self._error_response(
                "A consulta está vazia.", "Consulta técnica não informada."))
            return
        current_query = query
        try:
            for iteration in range(1, self.config.max_iterations + 1):
                context = self._retrieve(current_query, **kwargs)
                messages = build_response_messages(current_query, context, iteration,
                                                    self.config.max_iterations, context_is_sanitized=True)
                chunks: list[str] = []
                for chunk in self.llm.generate_stream_messages(messages):
                    chunks.append(chunk)
                    yield StreamEvent("token", chunk)
                try:
                    candidate = self._parse_response("".join(chunks))
                except ValueError as exc:
                    candidate = {"raciocinio": "JSON inválido.", "resposta": "", "fontes": [],
                                 "confianca": 0.0, "lacunas": [str(exc)]}
                candidate = self._ground_sources(candidate, context)
                if self._validate_response(candidate, min_confidence=self.config.min_confidence,
                                           max_gaps=self.config.max_gaps):
                    yield StreamEvent("final", self._normalize(candidate))
                    return
                if iteration < self.config.max_iterations:
                    yield StreamEvent("reset", {"reason": "validation_failed",
                                                "next_iteration": iteration + 1})
                    current_query = self._refine(current_query, candidate)
            normalized = self._normalize(candidate)
            normalized["raciocinio"] = (
                "A validação identificou evidência insuficiente ou campos incompletos; "
                "a resposta abaixo deve ser tratada como inconclusiva. "
                + str(normalized["raciocinio"])
            )
            normalized["confianca"] = min(float(normalized["confianca"]), 0.69)
            yield StreamEvent("final", normalized)
        except CircuitOpenError:
            yield StreamEvent("final", self._error_response(
                "O provedor de linguagem está temporariamente indisponível.",
                "Aguardar a recuperação do provedor e tentar novamente."))
        except Exception as exc:
            logger.exception("Garcia streaming failed.")
            yield StreamEvent("error", {"type": type(exc).__name__, "message": "Falha controlada no fluxo."})
            if self.llm.breaker.is_open:
                yield StreamEvent("final", self._error_response(
                    "O provedor de linguagem falhou repetidamente e foi temporariamente isolado.",
                    "Aguardar o circuit breaker liberar uma nova tentativa."))
            else:
                yield StreamEvent("final", self._error_response(
                    "A geração em streaming foi interrompida por uma falha controlada.",
                    f"Falha operacional: {type(exc).__name__}."))
