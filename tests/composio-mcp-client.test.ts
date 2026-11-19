import { describe, expect, it } from "vitest";
import { createComposioMcpDiscoveryClient } from "../src/core/composio/client";

const apiKey = "composio-project-api-key-for-tests";
const sessionId = "trs_1234567890abcdef";

describe("Composio MCP discovery adapter", () => {
  it("discovers remote tools with the server-side API key and requires explicit allowlisting", async () => {
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
    expect("callTool" in client).toBe(true);
    await client.initialize();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["GMAIL_LIST_EMAILS"]);
    await expect(client.callTool("GMAIL_LIST_EMAILS", {})).rejects.toThrow("mcp_tool_not_allowlisted");
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.url ===
      `https://app.composio.dev/tool_router/v3/${sessionId}/mcp`)).toBe(true);
    expect(requests.every((request) => request.headers.get("x-api-key") === apiKey)).toBe(true);
    expect(requests.every((request) => request.headers.get("authorization") === null)).toBe(true);
    expect(requests.every((request) => request.redirect === "manual")).toBe(true);
  });


  it("requires an explicit one-shot approved tool name for write operations", async () => {
    const makeFetcher = () => {
      const replies = [
        Response.json({ jsonrpc: "2.0", id: "init", result: {
          protocolVersion: "2025-11-25", serverInfo: { name: "composio", version: "1" },
        } }),
        new Response(null, { status: 202 }),
        Response.json({ jsonrpc: "2.0", id: "list", result: { tools: [{
          name: "GMAIL_SEND_EMAIL",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { destructiveHint: true },
        }] } }),
        Response.json({ jsonrpc: "2.0", id: "call", result: {
          content: [{ type: "text", text: "sent" }], isError: false,
        } }),
      ];
      return (async () => {
        const fetcher: typeof fetch = async () => {
          const next = replies.shift();
          if (!next) throw new Error("unexpected_request");
          return next;
        };
        return fetcher;
      })();
    };

    const fetcher = await makeFetcher();
    const denied = createComposioMcpDiscoveryClient({
      apiKey, sessionId, fetcher, allowedToolNames: ["GMAIL_SEND_EMAIL"],
    });
    await denied.initialize();
    await denied.listTools();
    await expect(denied.callTool("GMAIL_SEND_EMAIL", {}))
      .rejects.toThrow("mcp_tool_not_read_only_or_approved");

    const approvedFetcher = await makeFetcher();
    const approved = createComposioMcpDiscoveryClient({
      apiKey, sessionId, fetcher: approvedFetcher,
      allowedToolNames: ["GMAIL_SEND_EMAIL"],
      approvedToolNames: ["GMAIL_SEND_EMAIL"],
    });
    await approved.initialize();
    await approved.listTools();
    const result = await approved.callTool("GMAIL_SEND_EMAIL", {});
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "sent" }]);
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
