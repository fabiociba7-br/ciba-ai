import { describe, expect, it, vi } from "vitest";
import {
  createComposioOwnerSession,
  deleteComposioOwnerSession,
} from "../src/core/composio/sessions";

const sessionId = "trs_1234567890abcdef";
const mcpUrl = `https://app.composio.dev/tool_router/v3/${sessionId}/mcp`;
const validOptions = {
  apiKey: "project-api-key-for-tests",
  userId: `garcia_${"a".repeat(32)}`,
  toolkits: ["gmail", "github"],
};

describe("Composio owner sessions", () => {
  it("creates a scoped session with writes, instant usage, and workbench disabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      session_id: sessionId,
      mcp: { type: "http", url: mcpUrl },
    }, { status: 201 }));

    const result = await createComposioOwnerSession({ ...validOptions, fetcher });

    expect(result).toEqual({
      sessionId,
      mcpUrl,
      toolkits: ["github", "gmail"],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://backend.composio.dev/api/v3.1/tool_router/session");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("x-api-key")).toBe(validOptions.apiKey);
    expect(JSON.parse(String(init?.body))).toEqual({
      user_id: validOptions.userId,
      toolkits: { enable: ["github", "gmail"] },
      tags: { disable: ["createHint", "updateHint", "destructiveHint"] },
      instant: false,
      manage_connections: {
        enable: true,
        enable_wait_for_connections: true,
        enable_connection_removal: false,
      },
      workbench: { enable: false },
      proxy_execute: { enable: false },
      search: { enable: true },
      execute: { enable_multi_execute: false },
    });
  });

  it("accepts an explicit empty toolkit allowlist, never an omitted allowlist", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      session_id: sessionId,
      mcp: { type: "http", url: mcpUrl },
    }, { status: 201 }));
    await createComposioOwnerSession({ ...validOptions, toolkits: [], fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.toolkits).toEqual({ enable: [] });
  });

  it("rejects duplicate, malformed, and excessive toolkit lists before network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createComposioOwnerSession({
      ...validOptions, toolkits: ["gmail", "gmail"], fetcher,
    })).rejects.toThrow("composio_toolkits_duplicate");
    await expect(createComposioOwnerSession({
      ...validOptions, toolkits: ["Gmail API"], fetcher,
    })).rejects.toThrow("composio_toolkits_invalid");
    await expect(createComposioOwnerSession({
      ...validOptions, toolkits: Array.from({ length: 11 }, (_, i) => `app${i}`), fetcher,
    })).rejects.toThrow("composio_toolkits_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a session URL outside the fixed Composio MCP origin and path", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      session_id: sessionId,
      mcp: { type: "http", url: "https://attacker.example/collect" },
    }, { status: 201 }));
    await expect(createComposioOwnerSession({ ...validOptions, fetcher }))
      .rejects.toThrow("composio_mcp_endpoint_invalid");
  });

  it("blocks API redirects and reports provider errors without exposing response bodies", async () => {
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: "https://attacker.example" },
    }));
    await expect(createComposioOwnerSession({ ...validOptions, fetcher: redirect }))
      .rejects.toThrow("composio_redirect_blocked");

    const rejected = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: "invalid api key" }, { status: 401 },
    ));
    await expect(createComposioOwnerSession({ ...validOptions, fetcher: rejected }))
      .rejects.toThrow("composio_api_error_401");
  });

  it("bounds provider response bodies before JSON parsing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(64_001), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    await expect(createComposioOwnerSession({ ...validOptions, fetcher }))
      .rejects.toThrow("composio_response_too_large");
  });

  it("deletes only a validated session identifier with the project API key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteComposioOwnerSession(validOptions.apiKey, sessionId, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://backend.composio.dev/api/v3.1/tool_router/session/${sessionId}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("x-api-key")).toBe(validOptions.apiKey);
    await expect(deleteComposioOwnerSession(validOptions.apiKey, "not-a-session", fetcher))
      .rejects.toThrow("composio_configuration_invalid");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
