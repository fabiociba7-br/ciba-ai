import type { CibaToolConsentStore } from "./consent";
import type {
  CibaToolInvocationContext,
  CibaToolInvocationPlan,
  ExecutableCibaToolRegistry,
} from "./registry";

export type CibaToolApprovalState = "not_required" | "approval_required" | "approved";

export interface CibaToolProposal {
  plan: CibaToolInvocationPlan;
  approval: CibaToolApprovalState;
}

export interface CibaToolApprovalFlow {
  propose(toolId: string, input: unknown, context: CibaToolInvocationContext): CibaToolProposal;
  answer(
    plan: CibaToolInvocationPlan,
    context: CibaToolInvocationContext,
    allow: boolean
  ): boolean;
  execute(plan: CibaToolInvocationPlan, context: CibaToolInvocationContext): Promise<unknown>;
  cancel(context: CibaToolInvocationContext): boolean;
}

function snapshotContext(value: unknown): CibaToolInvocationContext {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_tool_invocation_context");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set(["conversationId", "invocationId"]);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new Error("invalid_tool_invocation_context");
  }
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_invocation_context");
    }
    fields[key] = descriptor.value;
  }
  if (typeof fields.conversationId !== "string" || !fields.conversationId.trim() ||
      fields.conversationId.length > 128 ||
      typeof fields.invocationId !== "string" || !fields.invocationId.trim() ||
      fields.invocationId.length > 128) {
    throw new Error("invalid_tool_invocation_context");
  }
  return Object.freeze({
    conversationId: fields.conversationId,
    invocationId: fields.invocationId,
  });
}

/**
 * Application-facing bridge for proposal, explicit approval and execution.
 * It never approves on behalf of the user and never executes from propose().
 * The registry authorizer must consume the matching consent for protected tools.
 */
export function createCibaToolApprovalFlow(
  registry: ExecutableCibaToolRegistry,
  consent: CibaToolConsentStore
): CibaToolApprovalFlow {
  if (!registry || typeof registry.prepare !== "function" ||
      typeof registry.execute !== "function" || !consent ||
      typeof consent.request !== "function" || typeof consent.answer !== "function" ||
      typeof consent.consume !== "function" || typeof consent.cancel !== "function") {
    throw new Error("invalid_tool_approval_dependencies");
  }

  function normalizePlan(value: unknown, context: CibaToolInvocationContext): CibaToolInvocationPlan {
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
    const fields: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_tool_invocation_plan");
      }
      fields[key] = descriptor.value;
    }
    if (fields.conversationId !== context.conversationId ||
        fields.invocationId !== context.invocationId ||
        typeof fields.toolId !== "string" ||
        (fields.risk !== "read" && fields.risk !== "write" && fields.risk !== "external") ||
        typeof fields.requiresApproval !== "boolean") {
      throw new Error("tool_invocation_plan_mismatch");
    }
    const canonical = registry.prepare(fields.toolId, fields.input, context);
    if (canonical.risk !== fields.risk ||
        canonical.requiresApproval !== fields.requiresApproval) {
      throw new Error("tool_invocation_plan_mismatch");
    }
    return canonical;
  }

  return Object.freeze({
    propose(toolId: string, input: unknown, rawContext: CibaToolInvocationContext): CibaToolProposal {
      const context = snapshotContext(rawContext);
      const plan = registry.prepare(toolId, input, context);
      if (!plan.requiresApproval) return Object.freeze({ plan, approval: "not_required" });

      const approval = consent.request({
        conversationId: context.conversationId,
        invocationId: context.invocationId,
        toolId: plan.toolId,
        risk: plan.risk,
        input: plan.input,
      });
      return Object.freeze({
        plan,
        approval: approval === "approved" ? "approved" : "approval_required",
      });
    },

    answer(
      plan: CibaToolInvocationPlan,
      rawContext: CibaToolInvocationContext,
      allow: boolean
    ): boolean {
      const context = snapshotContext(rawContext);
      if (typeof allow !== "boolean") return false;
      let safePlan: CibaToolInvocationPlan;
      try { safePlan = normalizePlan(plan, context); }
      catch { return false; }
      if (!safePlan.requiresApproval) return false;
      return consent.answer(
        context.invocationId,
        context.conversationId,
        safePlan.toolId,
        safePlan.input,
        allow
      );
    },

    async execute(plan: CibaToolInvocationPlan, rawContext: CibaToolInvocationContext): Promise<unknown> {
      const context = snapshotContext(rawContext);
      const safePlan = normalizePlan(plan, context);
      if (safePlan.requiresApproval) {
        const state = consent.request({
          conversationId: context.conversationId,
          invocationId: context.invocationId,
          toolId: safePlan.toolId,
          risk: safePlan.risk,
          input: safePlan.input,
        });
        if (state !== "approved") throw new Error("tool_approval_required");
      }
      return registry.execute(safePlan.toolId, safePlan.input, context);
    },

    cancel(rawContext: CibaToolInvocationContext): boolean {
      const context = snapshotContext(rawContext);
      return consent.cancel(context.invocationId, context.conversationId);
    },
  });
}
