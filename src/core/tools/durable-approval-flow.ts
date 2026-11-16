import { createCibaToolRegistry } from "./registry";
import type { CibaToolDefinition } from "./contracts";
import type {
  CibaToolInvocationContext,
  CibaToolInvocationPlan,
  CibaToolRegistryOptions,
  ExecutableCibaToolRegistry,
} from "./registry";
import type {
  DurableToolApprovalIdentity,
  DurableToolApprovalRequest,
  DurableToolApprovalStore,
} from "./durable-consent";

export type DurableCibaToolApprovalState = "not_required" | "approval_required" | "approved";

export type DurableCibaToolRegistryOptions = Omit<CibaToolRegistryOptions, "authorize"> & {
  approvals: DurableToolApprovalStore;
  authorize: CibaToolRegistryOptions["authorize"];
};

const durableRegistries = new WeakMap<object, DurableToolApprovalStore>();

/**
 * Creates a registry whose protected execution path consumes the exact durable
 * approval before invoking the application's independent authorization policy.
 * Direct registry.execute calls without a valid approval context fail closed.
 */
export function createDurableCibaToolRegistry(
  definitions: CibaToolDefinition[],
  options: DurableCibaToolRegistryOptions
): ExecutableCibaToolRegistry {
  const { approvals, authorize, ...registryOptions } = options;
  if (!approvals || typeof approvals.consume !== "function" || typeof authorize !== "function") {
    throw new Error("invalid_durable_tool_registry_options");
  }
  const registry = createCibaToolRegistry(definitions, {
    ...registryOptions,
    authorize: async (request) => {
      if (request.requiresApproval) {
        const approvalId = request.approvalId;
        const identity = request.approvalIdentity;
        if (!approvalId || !identity ||
            (request.risk !== "write" && request.risk !== "external") ||
            !request.conversationId || !request.invocationId) return false;
        const consumed = await approvals.consume({
          approvalId,
          identity,
          request: {
            conversationId: request.conversationId,
            invocationId: request.invocationId,
            toolId: request.toolId,
            risk: request.risk,
            input: request.input,
          },
        });
        if (consumed !== true) throw new Error("tool_approval_required");
      }
      return authorize(request);
    },
  });
  durableRegistries.set(registry, approvals);
  return registry;
}

export interface DurableCibaToolProposal {
  plan: CibaToolInvocationPlan;
  approval: DurableCibaToolApprovalState;
  approvalId?: string;
}

export interface DurableCibaToolApprovalFlow {
  readonly registry: ExecutableCibaToolRegistry;
  propose(
    identity: DurableToolApprovalIdentity,
    toolId: string,
    input: unknown,
    context: CibaToolInvocationContext
  ): Promise<DurableCibaToolProposal>;
  answer(args: {
    identity: DurableToolApprovalIdentity;
    approverDeviceId: string;
    approvalId: string;
    plan: CibaToolInvocationPlan;
    context: CibaToolInvocationContext;
    allow: boolean;
  }): Promise<boolean>;
  execute(args: {
    identity: DurableToolApprovalIdentity;
    approvalId?: string;
    plan: CibaToolInvocationPlan;
    context: CibaToolInvocationContext;
  }): Promise<unknown>;
  cancel(approvalId: string, identity: DurableToolApprovalIdentity): Promise<boolean>;
}

function snapshotContext(value: unknown): CibaToolInvocationContext {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_tool_invocation_context");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(["conversationId", "invocationId"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new Error("invalid_tool_invocation_context");
  }
  const conversationId = descriptors.conversationId?.value;
  const invocationId = descriptors.invocationId?.value;
  if (!descriptors.conversationId || !("value" in descriptors.conversationId) ||
      !descriptors.conversationId.enumerable ||
      !descriptors.invocationId || !("value" in descriptors.invocationId) ||
      !descriptors.invocationId.enumerable ||
      typeof conversationId !== "string" || !conversationId.trim() || conversationId.length > 128 ||
      typeof invocationId !== "string" || !invocationId.trim() || invocationId.length > 128) {
    throw new Error("invalid_tool_invocation_context");
  }
  return Object.freeze({ conversationId, invocationId });
}

/** Rebuilds a plan from trusted registry metadata and the caller's exact invocation context. */
function normalizePlan(
  registry: ExecutableCibaToolRegistry,
  value: unknown,
  context: CibaToolInvocationContext
): CibaToolInvocationPlan {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_tool_invocation_plan");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([
    "conversationId", "invocationId", "toolId", "risk", "requiresApproval", "input"
  ]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowed.size ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new Error("invalid_tool_invocation_plan");
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_invocation_plan");
    }
  }
  const fields = value as Record<string, unknown>;
  if (fields.conversationId !== context.conversationId ||
      fields.invocationId !== context.invocationId ||
      typeof fields.toolId !== "string" ||
      (fields.risk !== "read" && fields.risk !== "write" && fields.risk !== "external") ||
      typeof fields.requiresApproval !== "boolean") {
    throw new Error("tool_invocation_plan_mismatch");
  }
  const canonical = registry.prepare(fields.toolId, fields.input, context);
  if (canonical.risk !== fields.risk || canonical.requiresApproval !== fields.requiresApproval) {
    throw new Error("tool_invocation_plan_mismatch");
  }
  return canonical;
}

function approvalRequest(plan: CibaToolInvocationPlan, context: CibaToolInvocationContext): DurableToolApprovalRequest {
  if (!plan.requiresApproval || (plan.risk !== "write" && plan.risk !== "external")) {
    throw new Error("tool_approval_not_required");
  }
  return Object.freeze({
    conversationId: context.conversationId,
    invocationId: context.invocationId,
    toolId: plan.toolId,
    risk: plan.risk,
    input: plan.input,
  });
}

/**
 * Async bridge from validated tool proposals to the D1-backed one-use approval store.
 * Identity and approver device must be derived by the trusted application from authenticated
 * server-side sessions. Never accept them from model output or untrusted request JSON.
 */
export function createDurableCibaToolApprovalFlow(
  registry: ExecutableCibaToolRegistry,
  approvals: DurableToolApprovalStore
): DurableCibaToolApprovalFlow {
  if (!registry || typeof registry.prepare !== "function" || typeof registry.execute !== "function" ||
      durableRegistries.get(registry as object) !== approvals ||
      !approvals || typeof approvals.request !== "function" || typeof approvals.answer !== "function" ||
      typeof approvals.consume !== "function" || typeof approvals.cancel !== "function") {
    throw new Error("invalid_durable_tool_approval_dependencies");
  }

  const flow: DurableCibaToolApprovalFlow = {
    registry,
    async propose(identity, toolId, input, rawContext) {
      const context = snapshotContext(rawContext);
      const plan = registry.prepare(toolId, input, context);
      if (!plan.requiresApproval) return Object.freeze({ plan, approval: "not_required" as const });
      const request = approvalRequest(plan, context);
      const result = await approvals.request(identity, request);
      return Object.freeze({
        plan,
        approval: result.status === "approved" ? "approved" as const : "approval_required" as const,
        approvalId: result.approvalId,
      });
    },

    async answer({ identity, approverDeviceId, approvalId, plan, context: rawContext, allow }) {
      if (typeof allow !== "boolean" || typeof approvalId !== "string" || !approvalId.trim() ||
          typeof approverDeviceId !== "string" || !approverDeviceId.trim()) return false;
      const context = snapshotContext(rawContext);
      let safePlan: CibaToolInvocationPlan;
      try { safePlan = normalizePlan(registry, plan, context); }
      catch { return false; }
      if (!safePlan.requiresApproval) return false;
      return approvals.answer({
        approvalId,
        identity,
        request: approvalRequest(safePlan, context),
        approverDeviceId,
        allow,
      });
    },

    async execute({ identity, approvalId, plan, context: rawContext }) {
      const context = snapshotContext(rawContext);
      const safePlan = normalizePlan(registry, plan, context);
      if (safePlan.requiresApproval) {
        if (typeof approvalId !== "string" || !approvalId.trim()) {
          throw new Error("tool_approval_required");
        }
        return registry.execute(safePlan.toolId, safePlan.input, context, { approvalId, identity });
      }
      return registry.execute(safePlan.toolId, safePlan.input, context);
    },

    cancel(approvalId, identity) {
      return approvals.cancel(approvalId, identity);
    },
  };
  return Object.freeze(flow);
}
