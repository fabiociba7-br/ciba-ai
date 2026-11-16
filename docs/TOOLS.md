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
