import { describe, expect, it, vi } from "vitest";
import { CibaApiError, CibaClient } from "../src/client";

describe("CibaClient", () => {
  it("uses the latest token callback and sends chat through the shared API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({
        model: "model",
        response: "Olá",
        intelligence: { agent: "general", strategy: "single-pass", provider: "test", inference_calls: 1 },
      }), { status: 200 })
    );
    let token = "device-token-first";
    const client = new CibaClient({
      baseUrl: "https://private.example/",
      getAccessToken: () => token,
      fetcher,
    });

    await client.chat([{ role: "user", content: "Oi" }]);
    token = "device-token-second";
    await client.getInbox();

    expect(fetcher).toHaveBeenNthCalledWith(1, "https://private.example/v1/ai/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        cache: "no-store",
      })
    );
    const firstHeaders = new Headers(fetcher.mock.calls[0][1]?.headers);
    const secondHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer device-token-first");
    expect(secondHeaders.get("authorization")).toBe("Bearer device-token-second");
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/apps/messages/inbox?limit=20");
  });

  it("maps message and grant fields to the API contract", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ queued: true }), { status: 201 })
    );
    const client = new CibaClient({
      baseUrl: "https://private.example",
      getAccessToken: () => "device-token",
      fetcher,
    });

    await client.sendMessage({
      destinationAppId: "app-b",
      clientMessageId: "msg-1",
      taskId: "task-1",
      scope: "task",
      payload: { value: 1 },
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toEqual({
      destination_app_id: "app-b",
      client_message_id: "msg-1",
      task_id: "task-1",
      scope: "task",
      payload: { value: 1 },
    });
  });

  it("does not call authenticated endpoints without a token", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new CibaClient({ baseUrl: "https://private.example", fetcher });
    await expect(client.getInbox()).rejects.toMatchObject({
      status: 401,
      code: "device_token_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces structured API errors and rejects insecure remote URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ error: "message_access_not_granted" }), { status: 403 })
    );
    const client = new CibaClient({
      baseUrl: "https://private.example",
      getAccessToken: () => "device-token",
      fetcher,
    });
    await expect(client.getInbox()).rejects.toBeInstanceOf(CibaApiError);
    await expect(client.getInbox()).rejects.toMatchObject({
      status: 403,
      code: "message_access_not_granted",
    });
    expect(() => new CibaClient({ baseUrl: "http://api.example.com" }))
      .toThrow("ciba_base_url_must_use_https");
  });
});
