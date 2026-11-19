import { describe, expect, it } from "vitest";
import { createComposioMcpDiscoveryClient } from "../src/core/composio/client";

const apiKey = "composio-project-api-key-for-tests";
const sessionId = "trs_1234567890abcdef";

describe("Composio MCP discovery adapter", () => {
  it("discovers remote tools with the server-side API key and never exposes execution", async () => {
    const replies = [
      Response.json({
        jsonrpc: "2.0",
        id: "initialize",
        result: { protocolVersion: "2025-11-25", serverInfo: { name: "composio", version: "1" } },
      }),
      new Response(null, { status: 202 }),
      Response.json({
        jsonrpc: "2.0",
        id: "tools",
        result: {
          tools: [{
            name: "GMAIL_LIST_EMAILS",
            description: "List email messages",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
          }],
        },
      }),
    ];
    const requests: Request[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      const response = replies.shift();
      if (!response) throw new Error("unexpected_request");
      return response;
    };

    const client = createComposioMcpDiscoveryClient({ apiKey, sessionId, fetcher });
    expect("callTool" in client).toBe(false);
    await client.initialize();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["GMAIL_LIST_EMAILS"]);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.url ===
      `https://app.composio.dev/tool_router/v3/${sessionId}/mcp`)).toBe(true);
    expect(requests.every((request) => request.headers.get("x-api-key") === apiKey)).toBe(true);
    expect(requests.every((request) => request.headers.get("authorization") === null)).toBe(true);
    expect(requests.every((request) => request.redirect === "manual")).toBe(true);
  });

  it("rejects invalid API keys and session identifiers before network access", () => {
    expect(() => createComposioMcpDiscoveryClient({
      apiKey: "short",
      sessionId,
    })).toThrow("composio_configuration_invalid");
    expect(() => createComposioMcpDiscoveryClient({
      apiKey,
      sessionId: "../other-session",
    })).toThrow("composio_configuration_invalid");
  });
});
