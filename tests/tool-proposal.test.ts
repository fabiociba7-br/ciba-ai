import { describe, expect, it, vi } from "vitest";
import { runCibaOrchestrator } from "../src/core/orchestrator";
import { createCibaToolRegistry } from "../src/core/tools/registry";
import { createDurableCibaToolApprovalFlow, createDurableCibaToolRegistry } from "../src/core/tools/durable-approval-flow";
import type { DurableToolApprovalStore } from "../src/core/tools/durable-consent";
import { CIBA_TOOL_PROPOSAL_PREFIX, parseCibaToolModelProposal } from "../src/core/tools/model-proposal";
import type { InferenceRequest, InferenceResult, ModelProvider } from "../src/core/types";
const schema = { type: "object", properties: { section: { type: "string", maxLength: 40 } }, required: ["section"], additionalProperties: false };
function makeProvider(text: string) { const generate = vi.fn(async (_request: InferenceRequest): Promise<InferenceResult> => ({ text, raw: null, provider: "test-provider", model: "test-model" })); const provider: ModelProvider = { id: "test-provider", enabled: true, generate }; return { provider, generate }; }
function makeRegistry(execute = vi.fn(async (_input: unknown) => ({ ok: true }))) { const registry = createCibaToolRegistry([{ id: "profile.read", description: "Read a non-sensitive profile section", risk: "read", requiresApproval: false, inputSchema: schema, execute }], { allowlist: ["profile.read"], authorize: async () => true }); return { registry, execute }; }
const context = { conversationId: "conversation-1", invocationId: "invocation-1" };
const base = { messages: [{ role: "user" as const, content: "Leia meu perfil." }], model: "test-model", maxOutputTokens: 128 };
describe("model tool proposal protocol", () => {
  it("parses only the exact versioned envelope", () => { const parsed = parseCibaToolModelProposal(CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({ protocol: "ciba.tool.proposal.v1", toolId: "profile.read", input: { section: "preferences" } })); expect(parsed).toEqual({ toolId: "profile.read", input: { section: "preferences" } }); });
  it("does not mistake ordinary text for a proposal", () => { expect(parseCibaToolModelProposal("A resposta é 42.")).toBeNull(); });
  it("rejects malformed and extra-field envelopes", () => { expect(() => parseCibaToolModelProposal(CIBA_TOOL_PROPOSAL_PREFIX + "{")).toThrow("invalid_tool_proposal"); expect(() => parseCibaToolModelProposal(CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({ protocol: "ciba.tool.proposal.v1", toolId: "profile.read", input: {}, execute: true }))).toThrow("invalid_tool_proposal"); });
  it("returns a schema-validated preview without executing the tool", async () => { const { registry, execute } = makeRegistry(); const { provider, generate } = makeProvider(CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({ protocol: "ciba.tool.proposal.v1", toolId: "profile.read", input: { section: "preferences" } })); const result = await runCibaOrchestrator({ ...base, provider, toolRuntime: { registry, context } }); expect(result.toolProposal).toMatchObject({ toolId: "profile.read", risk: "read", requiresApproval: false, input: { section: "preferences" } }); expect(result.text).toContain("Nenhuma ação foi executada"); expect(execute).not.toHaveBeenCalled(); expect(generate.mock.calls[0][0].messages[0].content).toContain("profile.read"); expect(registry.describe()[0].inputSchema).toEqual(schema); });
  it("rejects unknown tools without execution", async () => { const { registry, execute } = makeRegistry(); const { provider } = makeProvider(CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({ protocol: "ciba.tool.proposal.v1", toolId: "profile.delete", input: {} })); const result = await runCibaOrchestrator({ ...base, provider, toolRuntime: { registry, context } }); expect(result.toolProposal).toBeUndefined(); expect(result.toolProposalError).toBe("tool_proposal_rejected"); expect(execute).not.toHaveBeenCalled(); });
  it("records durable approval for a protected model proposal without executing it", async () => {
    const identity = { ownerId: "owner-1", appId: "com.ciba.test", deviceId: "device-1" };
    const execute = vi.fn(async (_input: unknown) => ({ ok: true }));
    const request = vi.fn(async () => ({ approvalId: "approval-durable-1", status: "approval_required" as const }));
    const answer = vi.fn(async () => true);
    const consume = vi.fn(async () => true);
    const cancel = vi.fn(async () => true);
    const approvals: DurableToolApprovalStore = { request, answer, consume, cancel };
    const registry = createDurableCibaToolRegistry([{
      id: "profile.update",
      description: "Update a profile",
      risk: "write",
      requiresApproval: true,
      inputSchema: schema,
      execute,
    }], { allowlist: ["profile.update"], approvals, authorize: async () => true });
    const flow = createDurableCibaToolApprovalFlow(registry, approvals);
    const proposalText = CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({
      protocol: "ciba.tool.proposal.v1",
      toolId: "profile.update",
      input: { section: "preferences" }
    });
    const { provider } = makeProvider(proposalText);
    const result = await runCibaOrchestrator({
      ...base,
      provider,
      toolRuntime: { registry, context, durableApproval: { flow, identity } }
    });
    expect(result.toolProposal).toMatchObject({
      toolId: "profile.update",
      risk: "write",
      requiresApproval: true,
      input: { section: "preferences" }
    });
    expect(result.toolApproval).toEqual({
      status: "approval_required",
      approvalId: "approval-durable-1"
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(identity, expect.objectContaining({
      invocationId: context.invocationId,
      toolId: "profile.update",
      risk: "write",
      input: { section: "preferences" }
    }));
    expect(consume).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a durable flow bound to a different registry", async () => {
    const identity = { ownerId: "owner-1", appId: "com.ciba.test", deviceId: "device-1" };
    const approvals: DurableToolApprovalStore = {
      request: vi.fn(async () => ({ approvalId: "approval-1", status: "approval_required" as const })),
      answer: vi.fn(async () => true),
      consume: vi.fn(async () => true),
      cancel: vi.fn(async () => true)
    };
    const first = createDurableCibaToolRegistry([{
      id: "profile.update", description: "Update a profile", risk: "write",
      requiresApproval: true, inputSchema: schema, execute: async () => ({ ok: true })
    }], { allowlist: ["profile.update"], approvals, authorize: async () => true });
    const second = createDurableCibaToolRegistry([{
      id: "profile.update", description: "Update a profile", risk: "write",
      requiresApproval: true, inputSchema: schema, execute: async () => ({ ok: true })
    }], { allowlist: ["profile.update"], approvals, authorize: async () => true });
    const flow = createDurableCibaToolApprovalFlow(first, approvals);
    const { provider, generate } = makeProvider("unused");
    await expect(runCibaOrchestrator({
      ...base, provider, toolRuntime: { registry: second, context, durableApproval: { flow, identity } }
    })).rejects.toThrow("invalid_tool_runtime");
    expect(generate).not.toHaveBeenCalled();
  });
  it("preserves normal behavior without a tool runtime", async () => { const { provider } = makeProvider("Resposta normal."); const result = await runCibaOrchestrator({ ...base, provider }); expect(result.text).toBe("Resposta normal."); expect(result.toolProposal).toBeUndefined(); });
});