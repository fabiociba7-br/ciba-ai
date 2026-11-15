export type CibaChatMessage = { role: "user" | "assistant"; content: string };
export type CibaMessageScope = "task" | "context";
export type CibaGrantPermission = "send" | "receive" | "memory_read" | "memory_write";
export type CibaGrantScope = CibaMessageScope | "app_memory" | "owner_memory";

export interface CibaClientOptions {
  /** Base URL of the private Ciba AI Worker, e.g. https://api.example.com */
  baseUrl: string;
  /** Resolve the current device token at request time. Keep tokens in platform-secure storage. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Injectable fetch implementation for tests and platform adapters. */
  fetcher?: typeof fetch;
}

export interface CibaMessageInput<T = unknown> {
  destinationAppId: string;
  clientMessageId: string;
  taskId: string;
  scope: CibaMessageScope;
  payload: T;
  ttlHours?: number;
}

export interface CibaInboxMessage<T = unknown> {
  message_id: string;
  source_app_id: string;
  destination_app_id: string;
  task_id: string;
  scope: CibaMessageScope;
  payload: T;
  created_at: string;
  expires_at: string;
}

export interface CibaGrantInput {
  granteeAppId: string;
  sourceAppId?: string | null;
  destinationAppId?: string | null;
  permission: CibaGrantPermission;
  scope: CibaGrantScope;
  validHours?: number;
}

export class CibaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.name = "CibaApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Small, platform-neutral client for the private Ciba AI API.
 * It never persists credentials: the host app supplies a token callback.
 */
export class CibaClient {
  private readonly baseUrl: string;
  private readonly getAccessToken?: CibaClientOptions["getAccessToken"];
  private readonly fetcher: typeof fetch;

  constructor(options: CibaClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?$/i.test(baseUrl)) {
      throw new Error("ciba_base_url_must_use_https");
    }
    this.baseUrl = baseUrl;
    this.getAccessToken = options.getAccessToken;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = true
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("cache-control", "no-store");
    if (init.body !== undefined) headers.set("content-type", "application/json");

    if (authenticated) {
      const token = await this.getAccessToken?.();
      if (!token) throw new CibaApiError(401, "device_token_unavailable");
      headers.set("authorization", `Bearer ${token}`);
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { body = { error: "invalid_server_response" }; }
    }
    if (!response.ok) {
      const errorBody = body && typeof body === "object"
        ? body as Record<string, unknown>
        : {};
      throw new CibaApiError(
        response.status,
        typeof errorBody.error === "string" ? errorBody.error : "request_failed",
        body
      );
    }
    return body as T;
  }

  getStatus<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/v1/status", {}, false);
  }

  getConfig<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/v1/config", {}, false);
  }

  getCapabilities<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("/v1/ai/capabilities", {}, false);
  }

  registerDevice(appId: string, invitationCode: string): Promise<{
    device_id: string;
    access_token: string;
    token_type: "Bearer";
  }> {
    return this.request("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ app_id: appId, invitation_code: invitationCode }),
    }, false);
  }

  pairOwner(pairingInvitationCode: string): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/pair", {
      method: "POST",
      body: JSON.stringify({ pairing_invitation_code: pairingInvitationCode }),
    });
  }

  chat(messages: CibaChatMessage[]): Promise<{
    model: string;
    response: string;
    intelligence: {
      agent: string;
      strategy: string;
      provider: string;
      inference_calls: number;
    };
  }> {
    return this.request("/v1/ai/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  }

  sendMessage<T>(input: CibaMessageInput<T>): Promise<Record<string, unknown>> {
    return this.request("/v1/apps/messages", {
      method: "POST",
      body: JSON.stringify({
        destination_app_id: input.destinationAppId,
        client_message_id: input.clientMessageId,
        task_id: input.taskId,
        scope: input.scope,
        payload: input.payload,
        ...(input.ttlHours === undefined ? {} : { ttl_hours: input.ttlHours }),
      }),
    });
  }

  getInbox<T = unknown>(limit = 20): Promise<{
    messages: Array<CibaInboxMessage<T>>;
    count: number;
    maximum: number;
  }> {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
    return this.request(`/v1/apps/messages/inbox?limit=${safeLimit}`);
  }

  acknowledgeMessages(messageIds: string[]): Promise<{
    acknowledged: number;
    requested: number;
  }> {
    return this.request("/v1/apps/messages/ack", {
      method: "POST",
      body: JSON.stringify({ message_ids: messageIds }),
    });
  }

  listAccessGrants<T = Record<string, unknown>>(): Promise<{ grants: T[]; maximum: number }> {
    return this.request("/v1/owner/access-grants");
  }

  createAccessGrant(input: CibaGrantInput): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/access-grants", {
      method: "POST",
      body: JSON.stringify({
        grantee_app_id: input.granteeAppId,
        source_app_id: input.sourceAppId ?? null,
        destination_app_id: input.destinationAppId ?? null,
        permission: input.permission,
        scope: input.scope,
        ...(input.validHours === undefined ? {} : { valid_hours: input.validHours }),
      }),
    });
  }

  revokeAccessGrant(grantId: string): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/access-grants/revoke", {
      method: "POST",
      body: JSON.stringify({ grant_id: grantId }),
    });
  }
}
