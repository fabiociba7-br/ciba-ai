# Ciba AI Multi-Model Ensemble

The ensemble is an explicit opt-in primitive in `src/core/ensemble.ts`. It is not part of the default chat orchestration path and is not activated merely by registering providers.

## Activation requirements

- The caller must supply a trusted, application-created plan with `enabled: true`.
- Every expert provider and the synthesis provider must be enabled and explicitly marked zero-cost approved.
- The plan supports one to three expert calls, plus one synthesis call.
- Expert models and the synthesis model must not all resolve to the same provider/model identity.
- Each expert role must be a known specialist role; the general role is reserved for the default chat path.
- Input messages, plan objects, member records, arrays, and provider metadata are snapshotted before any inference call. Accessor-backed records and sparse or extended arrays are rejected.
- Output-token budgets are bounded per expert and in aggregate.

## Execution behavior

Expert calls run independently. A failed expert is omitted if at least one other expert succeeds; if every expert fails, the ensemble stops. The synthesis provider receives the original request and bounded expert reports as untrusted data, and produces the single combined response.

The reported inference-call count includes successful expert calls and the synthesis call. The requested token budget reports the budget allocated to those calls, not measured provider usage or billing.

## Security and cost boundaries

The ensemble does not execute tools, perform external research, or make a provider free. The zero-cost approval flags are trusted application policy assertions; they are not price verification. Applications must only set them after independently establishing that the configured route is permitted and has no charge.

The ensemble does not silently fall back to paid models. It also does not configure credentials, endpoints, providers, or cloud resources.

## Integration status

The ensemble remains separate from `runCibaOrchestrator`. The normal chat path continues to make one inference call. A future integration must preserve explicit opt-in, trusted policy configuration, aggregate call limits, and user-visible disclosure that multiple model calls are being used.
