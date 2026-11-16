import { describe, expect, it, vi } from "vitest";
import { createCibaToolRegistry } from "../src/core/tools/registry";
import { createDurableCibaToolApprovalFlow } from "../src/core/tools/durable-approval-flow";
import type { DurableToolApprovalIdentity, DurableToolApprovalRequest, DurableToolApprovalStore } from "../src/core/tools/durable-consent";

const context = { conversationId: "conversation-1", invocationId: "invocation-1" };
const identity: DurableToolApprovalIdentity = { ownerId: "owner-1", appId: "com.ciba.test", deviceId: "device-1" };
const approverDeviceId = "device-approver";
const schema = {
  type: "object",
  properties: { value: { type: "string", maxLength: 40 } },
  required: ["value"],
  additionalProperties: false,
};

function setup() {
  const execute = vi.fn(async (input: unknown) => ({ ok: true, input }));
  const authorize = vi.fn(async () => true);
  const registry = createCibaToolRegistry([{
    id: "profile.update",
    description: "Update a profile field",
    risk: "write",
    requiresApproval: true,
    inputSchema: schema,
    execute,
  }], { allowlist: ["profile.update"], authorize });

  const request = vi.fn(async (_identity: typeof identity, _request: DurableToolApprovalRequest) => ({
    approvalId: "approval-1",
    status: "approval_required" as const,
  }));
  const answer = vi.fn(async (_args: Parameters<DurableToolApprovalStore["answer"]>[0]) => true);
  const consume = vi.fn(async (_args: Parameters<DurableToolApprovalStore["consume"]>[0]) => true);
  const cancel = vi.fn(async (_id: string, _identity: typeof identity) => true);
  const store: DurableToolApprovalStore = { request, answer, consume, cancel };
  const flow = createDurableCibaToolApprovalFlow(registry, store);
  return { flow, execute, authorize, request, answer, consume, cancel };
}

describe("durable tool approval flow", () => {
  it("persists a protected proposal without executing it", async () => {
    const { flow, execute, request } = setup();
    const proposal = await flow.propose(identity, "profile.update", { value: "Curitiba" }, context);
    expect(proposal).toMatchObject({ approval: "approval_required", approvalId: "approval-1" });
    expect(request).toHaveBeenCalledWith(identity, expect.objectContaining({
      invocationId: context.invocationId,
      toolId: "profile.update",
      risk: "write",
      input: { value: "Curitiba" },
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("answers only a plan bound to the same invocation and delegates approver identity", async () => {
    const { flow, answer } = setup();
    const proposal = await flow.propose(identity, "profile.update", { value: "Curitiba" }, context);
    expect(await flow.answer({
      identity, approverDeviceId, approvalId: proposal.approvalId!, plan: proposal.plan, context, allow: true,
    })).toBe(true);
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval-1",
      approverDeviceId,
      request: expect.objectContaining({ invocationId: context.invocationId }),
    }));
    expect(await flow.answer({
      identity, approverDeviceId, approvalId: "approval-1", plan: proposal.plan,
      context: { ...context, invocationId: "other-invocation" }, allow: true,
    })).toBe(false);
  });

  it("consumes the exact approval before execution and refuses replay", async () => {
    const { flow, execute, consume } = setup();
    const proposal = await flow.propose(identity, "profile.update", { value: "Curitiba" }, context);
    const result = await flow.execute({ identity, approvalId: proposal.approvalId, plan: proposal.plan, context });
    expect(result).toEqual({ ok: true, input: { value: "Curitiba" } });
    expect(consume).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    consume.mockResolvedValueOnce(false);
    await expect(flow.execute({ identity, approvalId: proposal.approvalId, plan: proposal.plan, context }))
      .rejects.toThrow("tool_approval_required");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not execute when approval is missing", async () => {
    const { flow, execute } = setup();
    const proposal = await flow.propose(identity, "profile.update", { value: "Curitiba" }, context);
    await expect(flow.execute({ identity, plan: proposal.plan, context })).rejects.toThrow("tool_approval_required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an altered plan before touching approval storage", async () => {
    const { flow, consume, execute } = setup();
    const proposal = await flow.propose(identity, "profile.update", { value: "Curitiba" }, context);
    const altered = { ...proposal.plan, input: { value: "Admin" } };
    await expect(flow.execute({ identity, approvalId: proposal.approvalId, plan: altered, context }))
      .rejects.toThrow("tool_invocation_plan_mismatch");
    expect(consume).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
