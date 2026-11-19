import { describe, expect, it } from "vitest";
import {
  classifyComposioTool,
  hashComposioToolSchema,
} from "../src/core/composio/policy";

const schema = { type: "object", properties: {}, additionalProperties: false };

describe("Composio local tool policy", () => {
  it("classifies an explicitly read-only list operation as read", () => {
    const policy = classifyComposioTool({
      name: "GMAIL_LIST_EMAILS",
      description: "List emails",
      inputSchema: schema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, ["gmail"]);

    expect(policy).toMatchObject({
      name: "GMAIL_LIST_EMAILS",
      toolkit: "gmail",
      risk: "read",
      requiresApproval: false,
    });
  });

  it("never lets remote read-only annotations downgrade a write verb", () => {
    const policy = classifyComposioTool({
      name: "GMAIL_SEND_EMAIL",
      inputSchema: schema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, ["gmail"]);

    expect(policy.risk).toBe("write");
    expect(policy.requiresApproval).toBe(true);
  });

  it("classifies unknown verbs as external and requires per-call approval", () => {
    const policy = classifyComposioTool({
      name: "GMAIL_MAGIC_OPERATION",
      inputSchema: schema,
      annotations: { readOnlyHint: true },
    }, ["gmail"]);

    expect(policy.risk).toBe("external");
    expect(policy.requiresApproval).toBe(true);
  });

  it("does not trust read-only annotations without a known read verb", () => {
    const policy = classifyComposioTool({
      name: "GMAIL_SYNC",
      inputSchema: schema,
      annotations: { readOnlyHint: true },
    }, ["gmail"]);

    expect(policy.risk).toBe("external");
  });

  it("requires the tool namespace to belong to an enabled toolkit", () => {
    expect(() => classifyComposioTool({
      name: "SLACK_LIST_MESSAGES",
      inputSchema: schema,
      annotations: { readOnlyHint: true },
    }, ["gmail"])).toThrow("composio_toolkit_not_enabled");
  });

  it("rejects malformed descriptors and hashes schemas deterministically", async () => {
    expect(() => classifyComposioTool({
      name: "bad name",
      inputSchema: schema,
    }, ["gmail"])).toThrow("composio_tool_descriptor_invalid");

    const first = await hashComposioToolSchema({ properties: { b: { type: "string" }, a: { type: "integer" } } });
    const second = await hashComposioToolSchema({ properties: { a: { type: "integer" }, b: { type: "string" } } });
    const changed = await hashComposioToolSchema({ properties: { a: { type: "string" }, b: { type: "string" } } });
    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });
});
