# Garcia Research — Operation Guide

## 1. Local execution

Install the optional package and run its tests:

```bash
python -m pip install -e ".[test]"
python -m pytest
```

Run a local report without pushing:

```bash
python -m garcia_research "JWT Security" --no-publish --json-output
# Equivalent:
python -m garcia_research --topic "JWT Security" --depth standard --focus vulnerability --focus mitigation --no-publish --json-output
```

The CLI accepts a positional topic or `--topic`. It writes machine-readable JSON to stdout with `--json-output`; diagnostics go to stderr. Publication is opt-in with `--publish`, and `--no-publish` always takes precedence.

## 2. ResearchConfig

```python
from pathlib import Path
from garcia_research import GarciaResearchService, ResearchConfig
from garcia_research.adapters import LocalPromptAdapter

config = ResearchConfig(
    repo_path=Path.cwd(),          # existing ciba-ai clone
    reports_dir="reports/research",
    branch="feat/garcia-research-package",
    max_queries=5,
    publish_enabled=False,         # safest default
)
with GarciaResearchService(config, llm_client=LocalPromptAdapter()) as service:
    report = service.run(
        "Vulnerabilities in OAuth2 flows",
        depth="standard",
        focus=["PKCE", "redirect_uri", "token replay"],
    )
print(report.to_dict())
```

Depth controls the query budget: quick=2, standard=5, deep=8 (also bounded by `ResearchConfig.max_queries`). Focus terms are incorporated into generated queries.

## 3. LLM adapters

- `LocalPromptAdapter`: default, offline, no API key and no external inference call.
- `OpenAIAdapter`: set `OPENAI_API_KEY`; optionally set `OPENAI_MODEL`. Instantiate explicitly; never log the key.
- `GarciaLLMAdapter`: for a future authenticated HTTPS Garcia inference endpoint. The endpoint contract is POST `{"prompt":"..."}`, response `{"text":"..."}` or `{"output":"..."}`. Configure the endpoint explicitly and store its bearer token in `GARCIA_LLM_TOKEN`. No internal Garcia URL is assumed or invented.

All adapters implement `generate(prompt: str) -> str`, matching the package's `LLMClient` protocol.

## 4. GitHub Publisher states

| Status | Meaning | Operator action |
|---|---|---|
| `saved_only` | Files saved; publication disabled | Inspect local report; publish later if desired |
| `published` | Commit and push succeeded | Review report in the target branch |
| `skipped_dirty_worktree` | Worktree had pre-existing changes | Keep user changes; review and commit report separately |
| `skipped_wrong_branch` | Checked-out branch differs from configured branch | Switch to the intended branch and retry |
| `push_failed` | Local commit exists, remote push failed | Inspect commit and remote divergence; resolve manually |
 
The publisher never resets, cleans, rebases automatically, or force-pushes. Do not discard user changes just to publish a report.

## 5. Tool calling and Worker-to-Job flow

The function schema lives at `garcia_research/tool_schema.json`. Add it to the existing Garcia tool registry; do not create a parallel LLM or tool registry. When the model calls `garcia_research`, validate the arguments, create a correlation ID, persist a queued job, and dispatch GitHub Actions.

Cloudflare Workers do not execute Python. The supported deployment pattern is:

1. Worker validates the tool-call arguments and stores a job record.
2. Worker calls the GitHub Actions `workflow_dispatch` endpoint using a secret token.
3. Worker returns HTTP 202 and a request ID; it does not hold the chat request open.
4. The workflow checks out the package branch, runs `python -m garcia_research`, and uploads a JSON/Markdown artifact. Publishing is disabled by default.
5. A status/polling route checks the Actions run and returns the report/artifact when complete. A production implementation should persist run ID and status in D1 or the existing durable agent-job store.

Reference Worker code: [snippets/research-worker.ts](snippets/research-worker.ts).

### Cloudflare secret and variables

Set Worker secret `GITHUB_RESEARCH_TOKEN` to a fine-grained token restricted to this repository with Actions: write. Add Contents: write only if enabling the workflow's optional report commit. Set non-secret variables:

- `GITHUB_REPOSITORY=fabiociba7-br/ciba-ai`
- `GITHUB_RESEARCH_WORKFLOW=research-job.yml`
- `GITHUB_RESEARCH_REF=feat/garcia-research-package`

Do not put the token in Wrangler vars, source code, Android app configuration, or tool-call arguments.

### Workflow trigger

The `.github/workflows/research-job.yml` workflow accepts topic, depth, focus, request ID, and a publish boolean. Its default is artifact-only. The workflow is triggered on the package branch and uploads a `garcia-research-report` artifact. Optional Git publication is limited to the checked-out branch and still uses the package's dirty-worktree guard.

## 6. Integration boundaries

The Python package remains optional and independent. The Worker only dispatches and observes jobs; it does not import Python or duplicate the search implementation. Register the tool schema through the existing TypeScript tool registry and route tool execution through the existing job/approval policy. Do not let model-generated arguments directly authorize Git writes or other privileged operations.


## 7. Exemplo de chamada de ferramenta pelo LLM

Quando o modelo decidir pesquisar, a chamada estruturada terá este formato:

```json
{
  "type": "function",
  "function": {
    "name": "garcia_research",
    "arguments": "{\\"topic\\":\\"Falhas de segurança em OAuth2\\",\\"depth\\":\\"deep\\",\\"focus\\":[\\"PKCE\\",\\"redirect_uri\\",\\"token replay\\"]}"
  }
}
```

O runtime valida os argumentos, despacha o Job e devolve um identificador de correlação. O LLM não deve afirmar que a pesquisa terminou até receber o estado `completed` e o relatório correspondente.

**Nota de ativação:** o GitHub exige que o workflow com `workflow_dispatch` exista na branch padrão do repositório para aceitar o acionamento pela API. Enquanto esta implementação estiver somente na branch de feature, valide-a por CI; antes de habilitar o Worker em produção, publique o arquivo `.github/workflows/research-job.yml` na branch padrão. O Job pode continuar fazendo checkout e executando o código da branch `feat/garcia-research-package` por meio do campo `ref`. Não fiz esse merge automaticamente.
