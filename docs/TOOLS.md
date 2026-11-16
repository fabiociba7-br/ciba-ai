# Ciba AI Tool Registry

The tool registry is an opt-in execution boundary for application-defined functions. It does not discover tools, call tools from model output, or grant permissions by itself.

## Safe activation

A tool is executable only when all of the following are true:

1. The application defines the implementation in trusted code.
2. The tool ID is included in the registry's explicit `allowlist`.
3. The input matches the supported JSON Schema subset.
4. The application's trusted `authorize` callback returns exactly `true`.
5. The implementation returns a JSON-compatible value within the configured output limit.

An empty or omitted allowlist registers no tools. Invalid definitions are skipped rather than activated. Definitions with `write` or `external` risk must set `requiresApproval: true`; otherwise they are rejected during registration. The authorization callback must still verify a fresh, explicit approval before execution.

## Example

```ts
import { createCibaToolRegistry, createCibaToolConsentStore } from "./tools";

const registry = createCibaToolRegistry(
  [
    {
      id: "profile.read",
      description: "Read the current app profile",
      risk: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { section: { type: "string", maxLength: 40 } },
        required: ["section"],
        additionalProperties: false
      },
      execute: async ({ section }) => readProfileSection(section)
    }
  ],
  {
    allowlist: ["profile.read"],
    authorize: async (request) => {
      // Implement identity, current-session, app-grant and scope checks here.
      // For write/external actions, also verify a fresh user approval.
      return await applicationPolicyAllows(request);
    }
  }
);
```

The callback is part of the trusted application boundary. Do not implement it as an unconditional `true`, and do not treat a model-generated tool call as user approval. The `requiresApproval` flag is descriptive input to this callback; the registry deliberately does not invent or store approval state.

Registry lookup (`get` and `list`) returns metadata only; executable handlers and schemas remain private. The only public execution path is `registry.execute`, which validates the input and calls the trusted authorization callback before invoking a handler.

## Invocation preview (no execution)

The executable registry also exposes `prepare(toolId, input)`. It checks that the tool is registered and allowlisted, clones the proposed JSON input, enforces size and schema limits, and returns an immutable preview containing the tool ID, risk, approval requirement, and validated input.

Preparing a preview does **not** call the authorization callback, invoke the handler, reserve an approval, or create an approval token. A preview is not evidence of user consent and must never be treated as authorization. After the application obtains explicit approval through its own trusted UI/session policy, it must call `execute(toolId, input)`; execution independently validates the input and invokes the registry's trusted authorization callback immediately before the handler. Never execute solely because a model proposed a call or because a preview exists.

## Supported schema subset

- Objects with explicit properties, required keys, and `additionalProperties: false`
- Arrays with item schemas and optional length limits
- Strings with length limits and string enums (regular-expression patterns are intentionally unsupported to prevent pathological matching costs)
- Numbers and integers with minimum/maximum bounds and numeric enums
- Booleans and null

This is intentionally not a complete JSON Schema implementation. Unsupported keywords and schema types cause the definition to be rejected. Schema nesting is bounded, including nested array item schemas.

## Execution limits

Defaults are 64 tools, 32 KB per schema, 64 KB per input, 256 KB per output, 8 concurrent executions, and a 15-second wait timeout. The timeout rejects the caller's wait. If authorization finishes after the deadline, the handler is not started. A handler that has already started cannot be forcibly cancelled; its concurrency slot remains occupied until it settles.

Inputs and outputs are cloned through a strict JSON-value boundary. Non-finite numbers, accessors, custom prototypes, unsupported values, excessive nesting, and prototype-sensitive keys are rejected. Cloning also enforces a shared budget of 20,000 JSON nodes and 256 KB of cumulative string characters, so oversized or highly fragmented values are rejected before full serialization.

## Model proposal protocol (preview only)

When a trusted caller supplies an `ExecutableCibaToolRegistry` and invocation context to `runCibaOrchestrator`, the allowlisted tool descriptors and validated input schemas may be included in the system prompt. A model proposal must use the exact `CIBA_TOOL_CALL_V1` prefix (including its newline) followed by one JSON object with `protocol: "ciba.tool.proposal.v1"`, `toolId`, and `input`. The core parses the envelope strictly and calls `registry.prepare`; it returns a validated preview only. Unknown tools, malformed envelopes, and schema violations are rejected. No handler, authorization callback, network request, or side effect runs during proposal parsing.

This is deliberately not connected to the public Worker chat route. The current consent store is in-memory and cannot provide reliable cross-request approval state in a serverless Worker. Before connecting it, implement durable one-use approvals (with expiry, exact input binding and atomic consumption), authenticated approval endpoints, and a trusted client confirmation screen. No tool definitions are currently activated in production.

## Important integration boundary

The registry is currently an application-facing primitive. It is exported by the core package but is not connected to the orchestrator or to model tool-calling. Applications must invoke `registry.execute` themselves after their own policy checks. Never pass arbitrary model-provided function names directly to an executor, and never expose privileged application functions merely by adding them to a model prompt.

No provider, external service, or tool is activated by importing this module.


## Invocation-bound approval

Approval-required tools (`write` and `external`) must be prepared and executed with an explicit `{ conversationId, invocationId }` context. The application should use the same context and the exact `plan.input` when requesting consent, then pass that context and input to `execute`.

The exported `createCibaToolConsentStore()` provides a one-use in-memory consent boundary:

```ts
const consent = createCibaToolConsentStore();
const context = { conversationId, invocationId };
const plan = registry.prepare(toolId, proposedInput, context);

const state = consent.request({
  ...context,
  toolId: plan.toolId,
  risk: plan.risk,
  input: plan.input
});

if (state === "approval_required") {
  // Show the exact tool, risk and plan.input in trusted application UI.
  // Only call answer after the user explicitly chooses Allow or Deny.
  const allowed = consent.answer(
    context.invocationId,
    context.conversationId,
    plan.toolId,
    plan.input,
    userExplicitlyAllowed
  );
  if (!allowed) throw new Error("tool_authorization_denied");
}

const result = await registry.execute(plan.toolId, plan.input, context);
```

The registry's trusted `authorize` callback must consume the matching one-use grant. Configure it along these lines:

```ts
const consent = createCibaToolConsentStore();

const registry = createCibaToolRegistry(definitions, {
  allowlist: enabledToolIds,
  authorize: async (request) => {
    if (request.requiresApproval) return consent.consume(request);
    return await applicationPolicyAllows(request);
  }
});
```

Call `consent.request(...)` with the prepared plan before showing the approval panel; after the user answers, call `registry.execute(plan.toolId, plan.input, context)`. A grant expires after five minutes, is bound to the canonical input and cannot be reused. Denial, cancellation or a changed input cannot authorize execution. The store is in-memory only; it does not persist grants or silently approve future calls.

Do not set `userExplicitlyAllowed` from model output, a tool proposal, or a preview. It must come from the application's trusted user interaction.


## Application approval flow

For application code that needs one consistent proposal/approval/execution sequence, use the exported `createCibaToolApprovalFlow(registry, consent)`. It wraps the existing registry and one-use consent store; it does not connect model output to execution.

```ts
const consent = createCibaToolConsentStore();

const registry = createCibaToolRegistry(definitions, {
  allowlist: enabledToolIds,
  authorize: async (request) => {
    if (request.requiresApproval) return consent.consume(request);
    return await applicationPolicyAllows(request);
  }
});

const approvalFlow = createCibaToolApprovalFlow(registry, consent);
const context = { conversationId, invocationId };

// 1. Prepare only. This does not execute the handler.
const proposal = approvalFlow.propose(toolId, proposedInput, context);

// 2. Display the exact proposal in trusted UI. For protected actions,
//    call answer only after a real user Allow/Deny interaction.
if (proposal.approval === "approval_required") {
  const allowed = approvalFlow.answer(proposal.plan, context, userExplicitlyAllowed);
  if (!allowed) throw new Error("tool_authorization_denied");
}

// 3. Execute only after the explicit decision (when required).
const result = await approvalFlow.execute(proposal.plan, context);
```

For `write` and `external` tools, `propose` only creates a validated preview and a pending consent request. The application must display the exact proposal and call `answer` only from a trusted Allow/Deny interaction. `execute` refuses while approval is pending; the registry's trusted authorizer consumes the one-use consent immediately before the handler. Read-only tools still pass through the application's authorization policy. Call `cancel(context)` when the user abandons a pending approval.

This helper is an application integration primitive, not a UI component. It is not wired into `runCibaOrchestrator`, provider tool-calling, or any app screen. No tool can be invoked merely because a model proposed it.


## Durable approval storage (isolated D1 adapter)

Migration `0016_durable_tool_approvals.sql` provides the D1 table and composite device identity constraints. The new `createD1ToolApprovalStore(db)` adapter implements an asynchronous storage boundary with conditional state transitions:

- `request` persists a pending approval bound to owner, app, originating device, conversation, invocation, tool, risk, canonical input JSON and SHA-256 digest. Repeated identical requests are idempotent; rebinding an invocation to different content is rejected.
- `answer` accepts an explicit allow/deny decision only while pending and unexpired, and records an active approving device belonging to the same active owner and app.
- `consume` performs a single conditional `approved → consumed` update matching every immutable binding and expiry. Concurrent/replayed consumption can succeed only once.
- `cancel` closes an active pending or approved request. Expired pending/approved records are closed as `expired`.

The adapter receives identity as a separate trusted argument. Callers must derive owner, app, and device identifiers from authenticated server-side device context, never from a request body. The database enforces the owner/app relationship for both devices. The adapter is exported from the core package for controlled application integration.

**Integration remains intentionally disabled.** The adapter is not connected to `CibaToolApprovalFlow`, the public Worker, model orchestration, or any tool handler. The existing consent and approval-flow interfaces remain synchronous and in-memory. No approval endpoints, confirmation UI, tool definitions, remote D1 migration, or deployment were added. Tests exercise D1 persistence, immutable input binding, same-owner approver validation, expiry, cancellation, and concurrent one-use consumption.

Before enabling runtime execution, a separate integration stage must adapt the approval flow to async storage, derive authenticated owner/device context from the existing Worker authentication path, provide a trusted confirmation screen, and add end-to-end authorization tests. Do not treat this storage adapter by itself as user consent or permission to execute a tool.



## Durable approval flow adapter (application-facing; not activated in Worker)

`createDurableCibaToolApprovalFlow(registry, store)` connects validated registry previews to the asynchronous D1 approval store without adding HTTP routes or enabling production tools.

- `propose(identity, toolId, input, context)` validates the tool and persists a pending approval for `write` / `external` tools. It never invokes the handler.
- `answer(...)` records an explicit allow/deny decision. The caller must derive both the source identity and approver device ID from authenticated server-side sessions.
- `execute(...)` revalidates the exact plan, atomically consumes the one-use approval, and only then calls the registry. A failed registry authorization still burns the approval (fail closed).
- `cancel(...)` closes an approval through the durable store.

The adapter is an application-layer primitive only. It is not wired into the Worker chat route, public HTTP endpoints, production tool definitions, or any deployed D1 binding. Keep the raw registry private to the trusted application layer; never expose its `execute` method to untrusted clients. The registry's authorization callback must independently enforce authenticated identity, owner/app scopes, device status and application policy; do not configure it to consume the same durable approval a second time, because this flow consumes that approval immediately before calling the registry. A caller must enforce CSRF/session protections before calling this adapter. No migration or deployment is performed by this change.


## Authenticated approval inbox API

The Worker exposes owner-scoped approval management endpoints. All routes require a valid device bearer token; the owner identity is derived from the authenticated device record, never from request JSON.

- `GET /v1/owner/tool-approvals`: lists up to 20 unexpired pending or approved requests for the authenticated owner's current app. The response includes the source device, tool ID, risk, exact input, status and expiry so a trusted UI can show the action before a decision.
- `POST /v1/owner/tool-approvals/{approval_id}/decision`: accepts exactly `{"allow":true}` or `{"allow":false}`. The approver must be a paired, active device belonging to the same owner and app as the originating device. The server loads the original request from D1, verifies its stored SHA-256, and delegates the one-time state transition to the durable store. Replays and expired requests are rejected.
- `POST /v1/owner/tool-approvals/{approval_id}/cancel`: cancels a pending or approved request only when called by the active originating device.

The API does not execute tools. Approval is not equivalent to execution, and no tool registry, public chat route or production handler is connected. A client must present the full tool name, risk and exact input to the owner before sending a decision; never treat a model-generated preview as a trusted confirmation screen. The API is limited to the same app ID because the durable schema binds both source and approving devices to the same owner/app pair.


## Durable execution guard (required for D1-backed approvals)

Do not combine `createDurableCibaToolApprovalFlow` with a registry created by the generic `createCibaToolRegistry`. That arrangement consumes approval in the flow before calling `registry.execute`, while the registry's independent authorizer may either omit approval checks (a bypass) or try to consume the same one-use approval a second time.

For durable approvals, create the registry with `createDurableCibaToolRegistry` and pass the same durable store to both factories:

```ts
const approvals = createD1ToolApprovalStore(env.DB);

const registry = createDurableCibaToolRegistry(toolDefinitions, {
  allowlist: enabledToolIds,
  approvals,
  authorize: async (request) => {
    // Verify current owner/app grants, tool scopes, device state and policy.
    // Approval-required calls arrive here only after the D1 approval was
    // atomically consumed for this exact identity, invocation, tool and input.
    return await applicationPolicyAllows(request);
  }
});

const flow = createDurableCibaToolApprovalFlow(registry, approvals);
```

The durable registry factory wraps the trusted authorizer. For `write` and `external` tools it requires an execution authorization context, atomically consumes the matching D1 approval immediately before the independent application policy check, and fails closed when the approval is absent, expired, altered, already consumed, or bound to another owner/app/device/invocation. The registry rejects protected `execute` calls without that context. The approval is consumed once; the flow does not consume it a second time.

The authorization context is supplied only by trusted application code through `flow.execute({ identity, approvalId, plan, context })`. Never construct identity from model output or request-body identifiers. The SDK approval endpoints only record a decision; they do not invoke the tool. A failed application-policy check leaves the approval spent, which is intentional fail-closed behavior.

Tests must cover direct registry execution without approval, altered input, wrong identity, replay/concurrent consumption, expiry, and application-policy denial. This factory remains an application integration primitive; it does not activate tools in the public Worker or perform migrations/deployments.


## First built-in Garcia tools: native capability catalog

`createGarciaCapabilityTools({ authorize })` provides two read-only tools for inspecting Garcia's native capability catalog:

- `garcia.capabilities.list`: lists catalog entries and optionally filters by category.
- `garcia.capabilities.get`: returns one entry by capability ID.

Both tools are explicitly allowlisted, marked `risk: "read"`, and require no durable approval because they do not mutate state or contact external services. They still pass through the caller's trusted authorization callback, which must enforce the current user's read access.

These tools return catalog metadata only. They do not install or download models, invoke native adapters, change capability status, or imply that a planned capability is available. Unknown IDs return `{ found: false }`. Invalid inputs are rejected before the authorization callback.

This factory is an opt-in application primitive. It is not connected to the public Worker, chat runtime, or production tool catalog by this change. A caller must deliberately construct the registry and supply it to a trusted orchestration runtime. No deployment or migration is performed.


## Guarded read-only execution in the orchestrator

The optional `toolRuntime.executeReadOnlyProposals` flag is a trusted application setting, not a model-controlled field. When explicitly set to `true`, the orchestrator may execute a validated proposal only if the registered tool is marked `risk: "read"` and `requiresApproval: false`. The registry's trusted authorization callback still runs before the handler.

When the flag is absent or false, proposals remain previews. Write and external tools are never auto-executed by this option: they remain on the durable approval path and require an explicit owner decision followed by one-time approval consumption. Invalid flag values reject the runtime before model inference.

Execution output is returned separately as `toolExecution`; failures return a generic `toolExecutionError` without exposing internal exception details. This is still an opt-in orchestration primitive and does not enable any tools in the public Worker. The application must decide whether a given read tool's output is safe to disclose to the current authenticated user.


## Composing Garcia's first read-only runtime

For a trusted application that wants the capability catalog available to the orchestrator, use `createGarciaCapabilityToolRuntime`:

```ts
const toolRuntime = createGarciaCapabilityToolRuntime({
  context: { conversationId, invocationId },
  authorize: async (request) => {
    // Resolve access from the authenticated server-side session.
    return await canReadGarciaCapabilities(authenticatedSession, request);
  },
  executeReadOnlyProposals: true,
});

const result = await runCibaOrchestrator({
  messages,
  model,
  maxOutputTokens,
  provider,
  toolRuntime,
});
```

The factory validates and snapshots the invocation context. Read-only proposal execution remains off unless the trusted caller explicitly enables it. The model cannot set this flag: it is part of the server-side runtime object. The authorization callback is still mandatory and is evaluated before each read handler. Do not pass an identity, authorization callback, or runtime flag from untrusted request JSON.

This composition is tested end to end with the real `garcia.capabilities.list` and `garcia.capabilities.get` tools. It remains opt-in and is not connected to the public Worker by default.


## Owner-scoped read-only tools in chat

The authenticated `/v1/ai/chat` route now composes the native capability catalog into the orchestrator only when the calling device belongs to an active paired owner and its app remains enabled. The runtime creates fresh server-side conversation/invocation identifiers and uses a fixed allowlist of the two catalog tools. The authorization callback checks the authenticated owner binding, `risk: "read"`, `requiresApproval: false`, and the exact tool IDs.

The model receives the tool schemas and may propose a catalog lookup. The orchestrator executes it only through the registry authorization callback. The Worker returns the result in the optional `tool_execution` field; clients can render the structured metadata without treating it as model-authored prose. Execution failures are represented by a generic `tool_execution_error`.

Unpaired devices do not receive the tool catalog in their model context. This chat integration does not register write/external handlers, does not enable arbitrary native adapters, and does not execute any operation that changes state or contacts an external service. The existing durable approval API remains separate and does not imply execution.

### Segunda passagem de resposta após consulta de leitura

Quando uma ferramenta de leitura é executada com sucesso em runtime confiável, o orquestrador faz uma única segunda inferência para converter o resultado técnico em resposta natural. Essa passagem recebe somente a pergunta original e o resultado serializado como dado não confiável; não recebe catálogo nem runtime de ferramentas e não pode iniciar outra execução. O resultado é limitado a 12.000 caracteres antes de entrar no contexto. Se a segunda inferência falhar ou tentar emitir uma nova proposta de ferramenta, a resposta usa um fallback seguro e preserva o campo estruturado `tool_execution`. O fluxo fica limitado a uma execução e duas inferências por turno.
