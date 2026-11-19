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
      endpoint: `${endpoint}?token=must-not-be-in-url`,
      allowedHosts: [host],
    })).toThrow("mcp_endpoint_not_allowed");

    expect(() => createMcpHttpClient({
      endpoint: "https://mcp.example.test/mcp?access_token=secret",
      allowedHosts: [host],
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
    await expect(client.callTool("dangerous.write", {})).rejects.toThrow("mcp_tool_not_read_only_or_approved");
    // The tool registry snapshots validated JSON into null-prototype records.
    // MCP must accept those safe records instead of rejecting approved calls.
    const safeArgs = Object.create(null) as Record<string, unknown>;
    const result = await client.callTool("garcia.capabilities.list", safeArgs);
    expect(result).toEqual({ content: [{ type: "text", text: "[]" }], isError: false });
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.headers.get("authorization") === "Bearer test-device-token")).toBe(true);
    expect(requests.every((request) => request.redirect === "manual")).toBe(true);
    expect(requests[0].headers.get("mcp-protocol-version")).toBeNull();
    expect(requests.slice(1).every((request) => request.headers.get("mcp-protocol-version") === "2025-11-25")).toBe(true);
    expect(requests.every((request) => request.headers.get("accept")?.includes("text/event-stream"))).toBe(true);
    expect(JSON.parse(await requests[0].clone().text())).toMatchObject({
      method: "initialize",
      params: { clientInfo: { name: "garcia-mcp-client" } },
    });
    expect(JSON.parse(await requests[1].clone().text())).toMatchObject({
      method: "notifications/initialized",
    });
    expect(getAccessToken).toHaveBeenCalledTimes(4);
  });

  it("supports Composio-style API-key headers and Streamable HTTP SSE replies", async () => {
    const requests: Request[] = [];
    let callCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const body = request.method === "POST" ? await request.clone().json() as Record<string, unknown> : {};
      callCount += 1;
      if (callCount === 1) {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-11-25", serverInfo: { name: "composio", version: "1" } },
        });
      }
      if (callCount === 2) return new Response(null, { status: 202 });
      const result = callCount === 3
        ? { tools: [{
            name: "GMAIL_FETCH_EMAILS",
            description: "Fetch emails",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, destructiveHint: false },
          }] }
        : { content: [{ type: "text", text: "emails" }], isError: false };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    };
    const client = createMcpHttpClient({
      endpoint,
      allowedHosts: [host],
      getAuthHeaders: async () => ({ "x-api-key": "composio-project-key" }),
      allowedToolNames: ["GMAIL_FETCH_EMAILS"],
      fetcher,
    });

    await client.initialize();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["GMAIL_FETCH_EMAILS"]);
    const result = await client.callTool("GMAIL_FETCH_EMAILS", {});
    expect(result).toEqual({ content: [{ type: "text", text: "emails" }], isError: false });
    expect(requests.every((request) => request.headers.get("x-api-key") === "composio-project-key")).toBe(true);
    expect(requests.every((request) => request.headers.get("authorization") === null)).toBe(true);
    expect(requests.slice(1).every((request) => request.headers.get("mcp-protocol-version") === "2025-11-25")).toBe(true);
  });

  it("rejects auth headers outside the explicit provider allowlist", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createMcpHttpClient({
      endpoint,
      allowedHosts: [host],
      getAuthHeaders: async () => ({ host: "attacker.example" }),
      fetcher,
    });
    await expect(client.initialize()).rejects.toThrow("mcp_auth_header_not_allowed");
    expect(fetcher).not.toHaveBeenCalled();
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
