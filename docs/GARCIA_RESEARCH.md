# Garcia Research (Python tooling)

The `garcia_research/` package is optional Python 3.10+ research tooling. It is
not a second backend and is not deployed as part of the Cloudflare Worker.
The canonical ciba-ai backend remains TypeScript (`src/index.ts`) and uses
Cloudflare Workers AI through its existing provider registry.

## Dependency injection

`GarciaResearchService` accepts an object implementing
`LLMClient.generate(prompt: str) -> str`. This avoids creating a second model
client or duplicating provider configuration. The repository currently has no
Python LLM service; callers can inject an adapter that talks to an authorized
Garcia API or another already-configured service. Without an injected client,
query planning and synthesis use deterministic local behavior.

## Install and test

```bash
python -m pip install -e ".[test]"
pytest
```

## Example

```python
from garcia_research import GarciaResearchService, ResearchConfig

config = ResearchConfig(
    repo_path="/path/to/ciba-ai",
    branch="feat/garcia-research-package",
    publish_enabled=False,
)
with GarciaResearchService(config) as research:
    report = research.run("Vulnerabilities in OAuth2 flows")
print(report.executive_summary)
```

## Safety and publication

The client uses a persistent HTTP session, bounded delays, an in-memory cache
and exponential backoff for HTTP 429/503. It does not rotate browser identities
or bypass CAPTCHA/access restrictions. HTTP 401/403 and challenge pages fail
closed.

The publisher never force-pushes, resets, cleans or rebases. If the branch is
wrong it returns `skipped_wrong_branch`. If the worktree was already dirty
before report generation, reports are saved locally and it returns
`skipped_dirty_worktree` without committing. A rejected push returns
`push_failed` and retains the local commit for inspection.

Python tests are separate from the Cloudflare Worker Vitest suite. This package
is intentionally excluded from `tsconfig.json` and Worker deployment.
