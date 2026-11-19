import { describe, expect, it, vi } from "vitest";
import { createCibaToolRegistry } from "../src/core/tools/registry";
import { handleMcpRequest } from "../src/core/mcp/protocol";

const context = { conversationId: "mcp-test-conversation", invocationId: "mcp-test-invocation" };

function registry() {
  const read = vi.fn(async (input: { query: string }) => ({ found: true, query: input.query }));
  const write = vi.fn(async () => ({ changed: true }));
  const instance = createCibaToolRegistry([
    {
      id: "test.read",
      description: "Read-only test tool",
      risk: "read",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", minLength: 1, maxLength: 80 } },
        required: ["query"],
        additionalProperties: false,
      },
      execute: read,
    },
    {
      id: "test.write",
      description: "Write test tool",
      risk: "write",
      requiresApproval: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: write,
    },
  ], {
    allowlist: ["test.read", "test.write"],
    authorize: (request) => request.risk === "read" && request.requiresApproval === false,
  });
  return { instance, read, write };
}

const post = (body: unknown) => new Request("https://garcia.test/v1/mcp", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Garcia MCP JSON-RPC endpoint", () => {
  it("negotiates initialization without creating a session", async () => {
    const { instance } = registry();
    const response = await handleMcpRequest(post({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }), instance, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "garcia-mcp", version: "1.0.0" },
      },
    });
  });

  it("lists only read-only tools without approval requirements", async () => {
    const { instance } = registry();
    const response = await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }), instance, context);
    const body = await response.json() as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } };

    expect(body.result.tools.map((tool) => tool.name)).toEqual(["test.read"]);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it("executes an authorized read-only tool and returns its structured value as text", async () => {
    const { instance, read, write } = registry();
    const response = await handleMcpRequest(post({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "test.read", arguments: { query: "Garcia" } },
    }), instance, context);

    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0", id: 3,
      result: {
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ found: true, query: "Garcia" }) }],
      },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses write tools even when they exist in the underlying registry", async () => {
    const { instance, write } = registry();
    const response = await handleMcpRequest(post({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "test.write", arguments: {} },
    }), instance, context);

    expect((await response.json() as { result: { isError: boolean } }).result.isError).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("returns HTTP 202 for notifications and rejects unsupported methods", async () => {
    const { instance } = registry();
    const notification = await handleMcpRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }), instance, context);
    const unsupported = await handleMcpRequest(post({ jsonrpc: "2.0", id: 5, method: "resources/list" }), instance, context);

    expect(notification.status).toBe(202);
    expect(unsupported.status).toBe(200);
    expect(await unsupported.json()).toMatchObject({
      jsonrpc: "2.0", id: 5, error: { code: -32601 },
    });
  });

  it("rejects malformed requests and oversized content", async () => {
    const { instance } = registry();
    const malformed = await handleMcpRequest(new Request("https://garcia.test/v1/mcp", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }), instance, context);
    const oversized = await handleMcpRequest(new Request("https://garcia.test/v1/mcp", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(33_000) }),
    }), instance, context);

    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    expect(oversized.status).toBe(413);
  });
});
