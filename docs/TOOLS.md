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
import { createCibaToolRegistry } from "./tools";

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

## Supported schema subset

- Objects with explicit properties, required keys, and `additionalProperties: false`
- Arrays with item schemas and optional length limits
- Strings with length limits and string enums (regular-expression patterns are intentionally unsupported to prevent pathological matching costs)
- Numbers and integers with minimum/maximum bounds and numeric enums
- Booleans and null

This is intentionally not a complete JSON Schema implementation. Unsupported keywords and schema types cause the definition to be rejected. Schema nesting is bounded, including nested array item schemas.

## Execution limits

Defaults are 64 tools, 32 KB per schema, 64 KB per input, 256 KB per output, 8 concurrent executions, and a 15-second wait timeout. The timeout rejects the caller's wait; it cannot forcibly cancel a function that is already running. Its concurrency slot remains occupied until that function settles.

Inputs and outputs are cloned through a strict JSON-value boundary. Non-finite numbers, accessors, custom prototypes, unsupported values, excessive nesting, and prototype-sensitive keys are rejected.

## Important integration boundary

The registry is currently an application-facing primitive. It is exported by the core package but is not connected to the orchestrator or to model tool-calling. Applications must invoke `registry.execute` themselves after their own policy checks. Never pass arbitrary model-provided function names directly to an executor, and never expose privileged application functions merely by adding them to a model prompt.

No provider, external service, or tool is activated by importing this module.
