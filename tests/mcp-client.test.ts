import { describe, expect, it, vi } from "vitest";
import { createMcpHttpClient } from "../src/core/mcp/client";

const host = "mcp.example.test";
const endpoint = `https://${host}/mcp`;

describe("outbound MCP HTTP client", () => {
  it("requires HTTPS and an exact trusted host allowlist", () => {
    expect(() => createMcpHttpClient({
      endpoint: "http://mcp.example.test/mcp",
      allowedHosts: [host],
    })).toThrow("mcp_endpoint_not_allowed");

    expect(() => createMcpHttpClient({
      endpoint,
      allowedHosts: ["other.example.test"],
    })).toThrow("mcp_endpoint_not_allowed");

    expect(() => createMcpHttpClient({
      endpoint: "https://localhost/mcp",
      allowedHosts: ["localhost"],
    })).toThrow("mcp_endpoint_not_allowed");

    expect(() => createMcpHttpClient({
      endpoint: "https://mcp.example.test:8443/mcp",
      allowedHosts: [host],
    })).toThrow("mcp_endpoint_not_allowed");
  });

  it("initializes, discovers tools, and calls only a previously discovered tool", async () => {
    const replies = [
      Response.json({
        jsonrpc: "2.0",
        id: "initialize",
        result: { protocolVersion: "2025-11-25", serverInfo: { name: "test-mcp", version: "1" } },
      }),
      new Response(null, { status: 202 }),
      Response.json({
        jsonrpc: "2.0",
        id: "list",
        result: {
          tools: [{
            name: "garcia.capabilities.list",
            description: "List capabilities",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, destructiveHint: false },
          }, {
            name: "dangerous.write",
            description: "Write operation",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: false, destructiveHint: true },
          }],
        },
      }),
      Response.json({
        jsonrpc: "2.0",
        id: "call",
        result: { content: [{ type: "text", text: "[]" }], isError: false },
      }),
    ];
    const requests: Request[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      const response = replies.shift();
      if (!response) throw new Error("unexpected_request");
      return response;
    };
    const getAccessToken = vi.fn(async () => "test-device-token");
    const client = createMcpHttpClient({
      endpoint,
      allowedHosts: [host],
      getAccessToken,
      allowedToolNames: ["garcia.capabilities.list", "dangerous.write"],
      fetcher,
    });

    await expect(client.listTools()).rejects.toThrow("mcp_client_not_initialized");
    const initialized = await client.initialize();
    expect(initialized).toEqual({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "test-mcp", version: "1" },
    });
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["garcia.capabilities.list", "dangerous.write"]);

    await expect(client.callTool("unknown.tool", {})).rejects.toThrow("mcp_tool_not_discovered");
    await expect(client.callTool("dangerous.write", {})).rejects.toThrow("mcp_tool_not_read_only");
    const result = await client.callTool("garcia.capabilities.list", {});
    expect(result).toEqual({ content: [{ type: "text", text: "[]" }], isError: false });
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.headers.get("authorization") === "Bearer test-device-token")).toBe(true);
    expect(requests.every((request) => request.redirect === "error")).toBe(true);
    expect(JSON.parse(await requests[0].clone().text())).toMatchObject({
      method: "initialize",
      params: { clientInfo: { name: "garcia-mcp-client" } },
    });
    expect(JSON.parse(await requests[1].clone().text())).toMatchObject({
      method: "notifications/initialized",
    });
    expect(getAccessToken).toHaveBeenCalledTimes(4);
  });

  it("rejects oversized remote responses", async () => {
    const replies = [
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-11-25", serverInfo: { name: "test", version: "1" } },
      }),
      new Response(null, { status: 202 }),
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [], padding: "x".repeat(2_000) },
      }), { headers: { "content-type": "application/json" } }),
    ];
    const fetcher: typeof fetch = async () => {
      const response = replies.shift();
      if (!response) throw new Error("unexpected_request");
      return response;
    };
    const client = createMcpHttpClient({
      endpoint,
      allowedHosts: [host],
      fetcher,
      maxResponseBytes: 1_024,
    });
    await client.initialize();
    await expect(client.listTools()).rejects.toThrow("mcp_response_too_large");
  });

  it("rejects malformed or oversized access tokens before sending them", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createMcpHttpClient({
      endpoint,
      allowedHosts: [host],
      getAccessToken: async () => "bad\ntoken",
      fetcher,
    });
    await expect(client.initialize()).rejects.toThrow("mcp_access_token_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
