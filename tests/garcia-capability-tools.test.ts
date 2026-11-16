import { describe, expect, it, vi } from "vitest";
import { createGarciaCapabilityTools, createGarciaCapabilityToolRuntime } from "../src/core/tools/garcia-capability-tools";
import { runCibaOrchestrator } from "../src/core/orchestrator";
import { CIBA_TOOL_PROPOSAL_PREFIX } from "../src/core/tools/model-proposal";
import type { InferenceRequest, InferenceResult, ModelProvider } from "../src/core/types";

describe("Garcia read-only capability catalog tools", () => {
  it("lists only catalog metadata and can filter by category", async () => {
    const authorize = vi.fn(async () => true);
    const registry = createGarciaCapabilityTools({ authorize });

    expect(registry.list().map((tool) => tool.id)).toEqual([
      "garcia.capabilities.list",
      "garcia.capabilities.get",
    ]);
    expect(registry.list().every((tool) => tool.risk === "read" && !tool.requiresApproval)).toBe(true);

    const all = await registry.execute("garcia.capabilities.list", {});
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "coding_agent",
        status: "planned",
        modelWeightsBundled: false,
        readiness: {
          executable: false,
          blockers: ["not_available", "license_review_required", "adapter_missing"],
        },
      }),
    ]));

    const speech = await registry.execute("garcia.capabilities.list", {
      category: "speech_to_text",
    }) as Array<{ id: string }>;
    expect(speech.map((item) => item.id)).toEqual(["speech_to_text"]);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "garcia.capabilities.list",
      risk: "read",
      requiresApproval: false,
    }));
  });

  it("returns one capability without inventing an adapter or claiming availability", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    const result = await registry.execute("garcia.capabilities.get", {
      capabilityId: "image_generation",
    }) as {
      found: boolean;
      capability: { status: string; modelWeightsBundled: boolean };
      readiness: { executable: boolean; blockers: string[] };
    };

    expect(result.found).toBe(true);
    expect(result.capability.status).toBe("planned");
    expect(result.capability.modelWeightsBundled).toBe(false);
    expect(result.readiness).toEqual({
      capabilityId: "image_generation",
      status: "planned",
      licenseStatus: "review_required",
      adapterRegistered: false,
      adapterRuntime: null,
      executable: false,
      blockers: ["not_available", "license_review_required", "adapter_missing"],
    });
  });

  it("returns a safe not-found result for unknown capabilities", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    await expect(registry.execute("garcia.capabilities.get", {
      capabilityId: "unknown.capability",
    })).resolves.toEqual({ found: false });
  });

  it("rejects unknown properties and invalid categories before authorization", async () => {
    const authorize = vi.fn(async () => true);
    const registry = createGarciaCapabilityTools({ authorize });

    await expect(registry.execute("garcia.capabilities.list", {
      category: "not-a-category",
    })).rejects.toThrow("invalid_tool_input");
    await expect(registry.execute("garcia.capabilities.get", {
      capabilityId: "image_generation",
      install: true,
    })).rejects.toThrow("invalid_tool_input");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted application policy denies access", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => false });
    await expect(registry.execute("garcia.capabilities.list", {}))
      .rejects.toThrow("tool_authorization_denied");
  });

  it("builds a trusted runtime that can execute the first real Garcia read-only tool", async () => {
    const authorize = vi.fn(async () => true);
    const runtime = createGarciaCapabilityToolRuntime({
      authorize,
      context: { conversationId: "conversation-1", invocationId: "invocation-1" },
      executeReadOnlyProposals: true,
    });
    const proposal = CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({
      protocol: "ciba.tool.proposal.v1",
      toolId: "garcia.capabilities.list",
      input: { category: "coding" },
    });
    const generate = vi.fn(async (_request: InferenceRequest): Promise<InferenceResult> => ({
      text: proposal,
      raw: null,
      provider: "test-provider",
      model: "test-model",
    }));
    const provider: ModelProvider = {
      id: "test-provider",
      enabled: true,
      generate,
    };
    const result = await runCibaOrchestrator({
      messages: [{ role: "user", content: "Quais capacidades de programação estão catalogadas?" }],
      model: "test-model",
      maxOutputTokens: 128,
      provider,
      toolRuntime: runtime,
    });

    expect(result.toolExecution?.toolId).toBe("garcia.capabilities.list");
    expect(result.toolExecution?.output).toEqual([
      expect.objectContaining({ id: "coding_agent", status: "planned" }),
    ]);
    expect(result.toolExecutionError).toBeUndefined();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("keeps the Garcia capability runtime in preview mode by default", async () => {
    const runtime = createGarciaCapabilityToolRuntime({
      authorize: async () => true,
      context: { conversationId: "conversation-1", invocationId: "invocation-2" },
    });
    const proposal = CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({
      protocol: "ciba.tool.proposal.v1",
      toolId: "garcia.capabilities.get",
      input: { capabilityId: "image_generation" },
    });
    const provider: ModelProvider = {
      id: "test-provider",
      enabled: true,
      generate: async (_request: InferenceRequest): Promise<InferenceResult> => ({
        text: proposal,
        raw: null,
        provider: "test-provider",
        model: "test-model",
      }),
    };
    const result = await runCibaOrchestrator({
      messages: [{ role: "user", content: "Consulte geração de imagens." }],
      model: "test-model",
      maxOutputTokens: 128,
      provider,
      toolRuntime: runtime,
    });
    expect(result.toolProposal?.toolId).toBe("garcia.capabilities.get");
    expect(result.toolExecution).toBeUndefined();
  });

  it("rejects malformed context and runtime execution flags", () => {
    expect(() => createGarciaCapabilityToolRuntime({
      authorize: async () => true,
      context: { conversationId: "c", invocationId: "" },
    })).toThrow("invalid_garcia_capability_runtime");
    expect(() => createGarciaCapabilityToolRuntime({
      authorize: async () => true,
      context: { conversationId: "c", invocationId: "i" },
      executeReadOnlyProposals: "yes" as never,
    })).toThrow("invalid_garcia_capability_runtime");
  });

  it("requires a trusted authorizer and does not expose write or external tools", () => {
    expect(() => createGarciaCapabilityTools({ authorize: undefined as never }))
      .toThrow("garcia_capability_authorizer_required");
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    expect(registry.describe().every((tool) => tool.risk === "read")).toBe(true);
    expect(registry.get("garcia.capabilities.install")).toBeUndefined();
  });
});
