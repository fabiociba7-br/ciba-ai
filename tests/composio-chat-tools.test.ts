import { describe, expect, it, vi } from "vitest";
import {
  createComposioChatToolDefinitions,
  type SavedComposioChatPolicy,
} from "../src/core/composio/chat-tools";
import { hashComposioToolSchema } from "../src/core/composio/policy";
import { createGarciaCapabilityToolRuntime } from "../src/core/tools/garcia-capability-tools";
import { runCibaOrchestrator } from "../src/core/orchestrator";
import { CIBA_TOOL_PROPOSAL_PREFIX } from "../src/core/tools/model-proposal";
import type { InferenceRequest, InferenceResult, ModelProvider } from "../src/core/types";

const schema = { type: "object", properties: {}, additionalProperties: false };
const readTool = {
  name: "GMAIL_LIST_EMAILS",
  description: "List messages",
  inputSchema: schema,
  annotations: { readOnlyHint: true, destructiveHint: false },
};
const writeTool = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email",
  inputSchema: schema,
  annotations: { readOnlyHint: true, destructiveHint: false },
};

async function policy(
  name: string,
  overrides: Partial<SavedComposioChatPolicy> = {},
): Promise<SavedComposioChatPolicy> {
  return {
    tool_name: name,
    toolkit: "gmail",
    risk: name === "GMAIL_LIST_EMAILS" ? "read" : "write",
    requires_approval: name === "GMAIL_LIST_EMAILS" ? 0 : 1,
    schema_sha256: await hashComposioToolSchema(schema),
    enabled: 1,
    ...overrides,
  };
}

describe("Composio chat tool adapter", () => {
  it("exposes only explicitly enabled, schema-matched, locally read-only tools", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "two messages" }],
      isError: false,
    }));
    const definitions = await createComposioChatToolDefinitions({
      remoteTools: [readTool, writeTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [await policy("GMAIL_LIST_EMAILS"), await policy("GMAIL_SEND_EMAIL")],
      callTool,
    });

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: "composio.gmail_list_emails",
      risk: "read",
      requiresApproval: false,
    });
    const output = await definitions[0].execute({});
    expect(output).toEqual([{ type: "text", text: "two messages" }]);
    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith("GMAIL_LIST_EMAILS", {});
  });

  it("does not expose disabled policies or stale schemas", async () => {
    const definitions = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [
        await policy("GMAIL_LIST_EMAILS", { enabled: 0 }),
      ],
      callTool: async () => ({ content: [], isError: false }),
    });
    expect(definitions).toEqual([]);

    const stale = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [
        await policy("GMAIL_LIST_EMAILS", { schema_sha256: "0".repeat(64) }),
      ],
      callTool: async () => ({ content: [], isError: false }),
    });
    expect(stale).toEqual([]);
  });

  it("fails closed when local policy is not read-only or the toolkit is not enabled", async () => {
    const notReadOnly = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [
        await policy("GMAIL_LIST_EMAILS", { risk: "external", requires_approval: 1 }),
      ],
      callTool: async () => ({ content: [], isError: false }),
    });
    expect(notReadOnly).toEqual([]);

    const wrongToolkit = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["google_drive"],
      savedPolicies: [await policy("GMAIL_LIST_EMAILS")],
      callTool: async () => ({ content: [], isError: false }),
    });
    expect(wrongToolkit).toEqual([]);
  });

  it("rejects remote MCP tool errors instead of presenting them as successful data", async () => {
    const definitions = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [await policy("GMAIL_LIST_EMAILS")],
      callTool: async () => ({ content: [{ type: "text", text: "failure" }], isError: true }),
    });
    await expect(definitions[0].execute({})).rejects.toThrow("composio_read_tool_failed");
  });

  it("executes an authorized Composio read proposal through Garcia's normal orchestrator registry", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "three messages" }],
      isError: false,
    }));
    const definitions = await createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [await policy("GMAIL_LIST_EMAILS")],
      callTool,
    });
    const authorize = vi.fn(async (request: { toolId: string; risk: string; requiresApproval: boolean }) =>
      request.toolId === "composio.gmail_list_emails" &&
      request.risk === "read" && request.requiresApproval === false);
    const runtime = createGarciaCapabilityToolRuntime({
      authorize,
      context: { conversationId: "conversation-read", invocationId: "invocation-read" },
      executeReadOnlyProposals: true,
      additionalTools: definitions,
    });
    const proposal = CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({
      protocol: "ciba.tool.proposal.v1",
      toolId: "composio.gmail_list_emails",
      input: {},
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
      messages: [{ role: "user", content: "Liste meus e-mails recentes." }],
      model: "test-model",
      maxOutputTokens: 128,
      provider,
      toolRuntime: runtime,
    });

    expect(result.toolExecution?.toolId).toBe("composio.gmail_list_emails");
    expect(result.toolExecution?.output).toEqual([{ type: "text", text: "three messages" }]);
    expect(result.toolExecutionError).toBeUndefined();
    expect(callTool).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("validates limits and duplicate owner policy rows", async () => {
    const saved = await policy("GMAIL_LIST_EMAILS");
    await expect(createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [saved, saved],
      callTool: async () => ({ content: [], isError: false }),
    })).rejects.toThrow("duplicate_composio_chat_tool_policy");

    await expect(createComposioChatToolDefinitions({
      remoteTools: [readTool],
      enabledToolkits: ["gmail"],
      savedPolicies: [saved],
      callTool: async () => ({ content: [], isError: false }),
      maxTools: 17,
    })).rejects.toThrow("invalid_composio_chat_tool_limit");
  });
});
