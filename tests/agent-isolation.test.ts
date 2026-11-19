import { describe, expect, it } from "vitest";
import { getAgentIsolationPolicy, isolateAgentContext, isolateAgentTools } from "../src/core/agents/isolation";
import type { CibaToolModelDescriptor } from "../src/core/tools/contracts";

describe("agent isolation policies", () => {
  it("keeps only the newest context within each specialist budget", () => {
    const messages = [
      { role: "user" as const, content: "a".repeat(10_000) },
      { role: "assistant" as const, content: "b".repeat(10_000) },
      { role: "user" as const, content: "latest" },
    ];
    const result = isolateAgentContext("creative", messages);
    expect(result.at(-1)?.content).toBe("latest");
    expect(result.reduce((sum, item) => sum + item.content.length, 0))
      .toBeLessThanOrEqual(getAgentIsolationPolicy("creative").maxContextChars);
  });

  it("limits tool discovery by specialist risk policy and descriptor count", () => {
    const descriptors: CibaToolModelDescriptor[] = [
      { id: "read.one", description: "read", risk: "read", requiresApproval: false, inputSchema: { type: "object" } },
      { id: "write.one", description: "write", risk: "write", requiresApproval: true, inputSchema: { type: "object" } },
      { id: "external.one", description: "external", risk: "external", requiresApproval: true, inputSchema: { type: "object" } },
    ];
    expect(isolateAgentTools("general", descriptors).map((item) => item.id)).toEqual(["read.one"]);
    expect(isolateAgentTools("research", descriptors).map((item) => item.id))
      .toEqual(["read.one", "external.one"]);
    expect(isolateAgentTools("coding", descriptors).map((item) => item.id))
      .toEqual(["read.one", "write.one", "external.one"]);
  });

  it("shows approval-gated Composio proposals to general agents without exposing other write tools", () => {
    const descriptors: CibaToolModelDescriptor[] = [
      { id: "read.one", description: "read", risk: "read", requiresApproval: false, inputSchema: { type: "object" } },
      { id: "write.one", description: "write", risk: "write", requiresApproval: true, inputSchema: { type: "object" } },
      { id: "composio.gmail_send_email", description: "approved action proposal", risk: "write", requiresApproval: true, inputSchema: { type: "object" } },
      { id: "composio.gmail_search_emails", description: "unapproved write metadata", risk: "write", requiresApproval: false, inputSchema: { type: "object" } },
    ];
    expect(isolateAgentTools("general", descriptors).map((item) => item.id))
      .toEqual(["read.one", "composio.gmail_send_email"]);
  });

  it("does not grant execution authority to higher-risk tools", () => {
    const policy = getAgentIsolationPolicy("coding");
    expect(policy.allowedToolRisks).toContain("write");
    expect(policy.allowedToolRisks).toContain("external");
    expect(policy).not.toHaveProperty("autoApprove");
  });
});
