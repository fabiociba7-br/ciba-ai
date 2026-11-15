export const GARCIA_APP_CONTRACT_VERSION = "1.0.0" as const;

export type CibaChatMessage = { role: "user" | "assistant"; content: string };
export type CibaMessageScope = "task" | "context";
export type CibaGrantPermission = "send" | "receive" | "memory_read" | "memory_write";
export type CibaGrantScope = CibaMessageScope | "app_memory" | "owner_memory";

export interface CibaAppIdentity {
  contract: "garcia-app";
  contract_version: string;
  identity: {
    app_id: string;
    display_name: string;
    enabled: boolean;
    description: string;
    app_type: string;
    capabilities: string[];
    task_types: string[];
  };
  device: { device_id: string; owner_linked: boolean };
  connected_apps: Array<{
    app_id: string;
    display_name: string;
    description: string;
    app_type: string;
    capabilities: string[];
    task_types: string[];
    contract_version: string;
    active_device_count: number;
  }>;
  capability_semantics: {
    descriptive_only: true;
    grants_required_for_cross_app_access: true;
    app_actions_executable_by_garcia: false;
  };
}

export type CibaTaskType =
  | "analyze" | "classify" | "draft" | "extract" | "organize"
  | "plan" | "research" | "summarize" | "transcribe" | "translate";

export interface CibaTaskDispatchInput {
  taskType: CibaTaskType;
  instruction: string;
  clientMessageId: string;
  preferredAppId?: string;
  context?: unknown;
  ttlHours?: number;
}

export interface CibaTaskResultInput<T = unknown> {
  taskId: string;
  clientMessageId: string;
  result: T;
  status?: "completed" | "failed" | "partial";
}

export interface CibaTaskResults<T = unknown> {
  task_id: string;
  results: Array<{
    message_id: string;
    source_app_id: string;
    task_id: string;
    payload: {
      protocol: "garcia.task.result";
      status: "completed" | "failed" | "partial";
      result: T;
    };
    created_at: string;
    expires_at: string;
  }>;
  count: number;
  maximum: number;
  consolidation: {
    status: "awaiting_results" | "no_successful_results" | "single_result" | "agreement" | "divergent";
    task_id: string;
    total_results: number;
    completed_results: number;
    partial_results: number;
    failed_results: number;
    distinct_successful_outputs: number;
    agreement: boolean | null;
    consensus_result: T | null;
    sources: Array<{ app_id: string; status: "completed" | "partial" | "failed" }>;
    divergent_source_app_ids: string[];
  };
}

export interface CibaTaskDispatchResult {
  dispatched: true;
  duplicate: boolean;
  route: {
    message_id: string;
    task_id: string;
    source_app_id?: string;
    destination_app_id: string;
    destination_display_name?: string;
    task_type?: CibaTaskType;
    scope?: "task";
    created_at: string;
    expires_at: string;
    result_delivery?: "destination_app_must_reply_with_same_task_id";
  };
}

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

export type CibaMemoryScope = "app" | "owner";

export interface CibaMemoryInput {
  scope: CibaMemoryScope;
  key: string;
  value: string;
  consent: "curated";
  sourceAppId?: string;
  validHours?: number;
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

  getAppIdentity(): Promise<CibaAppIdentity> {
    return this.request<CibaAppIdentity>("/v1/apps/identity");
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

  dispatchTask(input: CibaTaskDispatchInput): Promise<CibaTaskDispatchResult> {
    return this.request("/v1/apps/tasks/dispatch", {
      method: "POST",
      body: JSON.stringify({
        task_type: input.taskType,
        instruction: input.instruction,
        client_message_id: input.clientMessageId,
        ...(input.preferredAppId === undefined ? {} : { preferred_app_id: input.preferredAppId }),
        ...(input.context === undefined ? {} : { context: input.context }),
        ...(input.ttlHours === undefined ? {} : { ttl_hours: input.ttlHours }),
      }),
    });
  }

  submitTaskResult<T>(input: CibaTaskResultInput<T>): Promise<Record<string, unknown>> {
    return this.request("/v1/apps/tasks/results", {
      method: "POST",
      body: JSON.stringify({
        task_id: input.taskId,
        client_message_id: input.clientMessageId,
        status: input.status ?? "completed",
        result: input.result,
      }),
    });
  }

  async getTaskResults<T = unknown>(taskId: string): Promise<CibaTaskResults<T>> {
    if (!taskId.trim() || taskId.length > 100) throw new Error("invalid_task_id");
    return this.request(`/v1/apps/tasks/results?task_id=${encodeURIComponent(taskId)}`);
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

  listAvailableApps<T = Record<string, unknown>>(): Promise<{ apps: T[] }> {
    return this.request("/v1/owner/available-apps");
  }

  createAppConnectionInvitation(appId: string): Promise<{
    app_id: string;
    registration_invitation_code: string;
    pairing_invitation_code: string;
    expires_at: string;
    note: string;
  }> {
    return this.request("/v1/owner/apps/connect", {
      method: "POST",
      body: JSON.stringify({ app_id: appId }),
    });
  }
  getOwnerDashboard<T = Record<string, unknown>>(): Promise<T> {
    return this.request("/v1/owner/dashboard");
  }

  getOwnerSettings<T = Record<string, unknown>>(): Promise<{ settings: T }> {
    return this.request("/v1/owner/settings");
  }

  updateOwnerSettings(settings: { memory_enabled?: boolean; app_messaging_enabled?: boolean }): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/settings", {
      method: "POST",
      body: JSON.stringify({ settings }),
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

  listMemory<T = Record<string, unknown>>(scope: CibaMemoryScope = "app", sourceAppId?: string): Promise<{ memories: T[]; maximum: number; scope: CibaMemoryScope }> {
    const params = new URLSearchParams({ scope });
    if (sourceAppId) params.set("source_app_id", sourceAppId);
    return this.request(`/v1/owner/memory?${params.toString()}`);
  }

  saveMemory(input: CibaMemoryInput): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ scope: input.scope });
    if (input.sourceAppId) params.set("source_app_id", input.sourceAppId);
    return this.request(`/v1/owner/memory?${params.toString()}`, {
      method: "POST",
      body: JSON.stringify({
        scope: input.scope, key: input.key, value: input.value, consent: input.consent,
        ...(input.sourceAppId === undefined ? {} : { source_app_id: input.sourceAppId }),
        ...(input.validHours === undefined ? {} : { valid_hours: input.validHours }),
      }),
    });
  }

  deleteMemory(memoryId: string, scope: CibaMemoryScope = "app", sourceAppId?: string): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ scope });
    if (sourceAppId) params.set("source_app_id", sourceAppId);
    return this.request(`/v1/owner/memory?${params.toString()}`, {
      method: "DELETE", body: JSON.stringify({ memory_id: memoryId }),
    });
  }

  revokeOwnerDevice(deviceId: string): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/devices/revoke", {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
  }
  revokeAccessGrant(grantId: string): Promise<Record<string, unknown>> {
    return this.request("/v1/owner/access-grants/revoke", {
      method: "POST",
      body: JSON.stringify({ grant_id: grantId }),
    });
  }
}
