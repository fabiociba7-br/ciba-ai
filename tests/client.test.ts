import { describe, expect, it, vi } from "vitest";
import { CibaApiError, CibaClient, GARCIA_APP_CONTRACT_VERSION } from "../src/client";

describe("CibaClient", () => {
  it("exports the integration contract version", () => {
    expect(GARCIA_APP_CONTRACT_VERSION).toBe("1.0.0");
  });
  it("discovers the authenticated app identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ identity: { app_id: "com.ciba.app" }, connected_apps: [] }), { status: 200 })
    );
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.getAppIdentity();
    expect(result.identity.app_id).toBe("com.ciba.app");
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/identity");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer device-token");
  });

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

  it("dispatches a typed task through the central coordinator", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        dispatched: true, duplicate: false,
        route: { task_id: "task-1", destination_app_id: "com.ciba.notes", created_at: "now", expires_at: "later" },
      }), { status: 201 })
    );
    const client = new CibaClient({
      baseUrl: "https://private.example",
      getAccessToken: () => "device-token",
      fetcher,
    });
    const result = await client.dispatchTask({
      taskType: "summarize",
      instruction: "Resuma o documento",
      clientMessageId: "task-request-1",
      preferredAppId: "com.ciba.notes",
      context: { document_id: "doc-1" },
    });
    expect(result.route.destination_app_id).toBe("com.ciba.notes");
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/tasks/dispatch");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      task_type: "summarize",
      instruction: "Resuma o documento",
      client_message_id: "task-request-1",
      preferred_app_id: "com.ciba.notes",
      context: { document_id: "doc-1" },
    });
  });

  it("retrieves a bounded task lifecycle status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-1", source_app_id: "com.ciba.source", destination_app_id: "com.ciba.notes",
      task_type: "summarize", created_at: "now",
      lifecycle: { status: "processing", acknowledged: true, result_count: 0, completed_results: 0, partial_results: 0, failed_results: 0, expires_at: "later" },
      automatic_execution: false, note: "Acknowledgement is not execution.",
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const status = await client.getTaskStatus("task-1");
    expect(status.lifecycle.status).toBe("processing");
    expect(status.automatic_execution).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/tasks/status?task_id=task-1");
    await expect(client.getTaskStatus("")).rejects.toThrow("invalid_task_id");
  });

  it("submits and retrieves correlated task results", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ submitted: true, duplicate: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "task-1", results: [], count: 0, maximum: 20, consolidation: { status: "awaiting_results", task_id: "task-1", total_results: 0, completed_results: 0, partial_results: 0, failed_results: 0, distinct_successful_outputs: 0, agreement: null, consensus_result: null, sources: [], divergent_source_app_ids: [] } }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    await client.submitTaskResult({
      taskId: "task-1", clientMessageId: "result-1",
      status: "completed", result: { summary: "Concluído" },
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      task_id: "task-1", client_message_id: "result-1",
      status: "completed", result: { summary: "Concluído" },
    });
    const results = await client.getTaskResults("task-1");
    expect(results.task_id).toBe("task-1");
    expect(results.consolidation.status).toBe("awaiting_results");
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/apps/tasks/results?task_id=task-1");
    await expect(client.getTaskResults("")).rejects.toThrow("invalid_task_id");
  });

  it("prepares a quote-backed memory candidate without saving it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidate: { key: "response_style", value: "Prefiro respostas diretas", evidence_excerpt: "Prefiro respostas diretas", source_role: "user", requires_confirmation: true, persisted: false },
      scope: "app", source_app_id: "com.ciba.app", next_step: "Confirmar e salvar explicitamente",
      stored: false, inference_calls: 0,
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.prepareMemoryCandidate({
      sourceText: "Prefiro respostas diretas e sem rodeios.",
      key: "response_style",
      value: "Prefiro respostas diretas",
    });
    expect(result.stored).toBe(false);
    expect(result.candidate.requires_confirmation).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/memory/candidates");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      source_role: "user",
      source_text: "Prefiro respostas diretas e sem rodeios.",
      key: "response_style",
      value: "Prefiro respostas diretas",
      scope: "app",
    });
    await expect(client.prepareMemoryCandidate({ sourceText: "x", key: "k", value: "x" })).rejects.toThrow("invalid_memory_candidate_source");
  });

  it("searches and edits curated memories with optional expiry controls", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ memories: [], maximum: 200, scope: "app", search: "rock", include_expired: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ updated: true, memory_id: "memory-1", scope: "app" }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const listed = await client.listMemory("app", undefined, { search: "rock", includeExpired: true });
    expect(listed.include_expired).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/memory?scope=app&q=rock&include_expired=true");
    const updated = await client.updateMemory({
      memoryId: "memory-1", scope: "app", key: "music", value: "Gosta de rock clássico.", validHours: 48,
    });
    expect(updated.updated).toBe(true);
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/owner/memory?scope=app");
    expect(fetcher.mock.calls[1][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      memory_id: "memory-1", key: "music", value: "Gosta de rock clássico.", consent: "curated", valid_hours: 48,
    });
    await expect(client.updateMemory({ memoryId: "", scope: "app", key: "x", value: "y" })).rejects.toThrow("invalid_memory_id");
  });

  it("retrieves metadata-only private memory history", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      events: [{ event_id: "event-1", memory_id: "memory-1", proposal_id: null, scope: "app",
        source_app_id: "com.example.app", memory_key: "preference", action: "updated",
        actor_app_id: "com.example.app", occurred_at: "2026-11-16T00:00:00.000Z" }],
      count: 1, limit: 50, scope: "app", source_app_id: "com.example.app", values_stored: false,
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.getMemoryHistory({ scope: "app", limit: 50 });
    expect(result.events[0].action).toBe("updated");
    expect(result.values_stored).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/memory/history?scope=app&limit=50");
  });

  it("retrieves the structured owner context profile", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      profile: { preferences: [], communication: [], work: [], interests: [], routines: [], personal_context: [], other: [] },
      recurring_preferences: [{ term: "diretas", occurrences: 2, memory_ids: ["a", "b"], memory_keys: ["response_style", "work_style"] }],
      review_suggestions: [], analyzed_records: 2, inference_calls: 0, automatic_changes: false,
      cross_app_memory_requires_explicit_grant: true, profile_is_inferred: false,
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.getOwnerProfile();
    expect(result.recurring_preferences[0].term).toBe("diretas");
    expect(result.inference_calls).toBe(0);
    expect(result.automatic_changes).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/profile");
  });

  it("retrieves deterministic memory relationship insights", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      possible_conflicts: [], related: [], outdated: [], analyzed_records: 2,
      inference_calls: 0, visibility: "own_app_and_explicit_memory_read_grants",
      cross_app_memory_requires_explicit_grant: true, automatic_changes: false,
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.getMemoryInsights();
    expect(result.analyzed_records).toBe(2);
    expect(result.inference_calls).toBe(0);
    expect(result.automatic_changes).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/memory/insights");
  });

  it("creates, lists and decides owner-reviewed memory proposals", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        proposal_id: "proposal-1", classification: "possible_conflict",
        requires_owner_decision: true, stored_as_memory: false, inference_calls: 0,
        existing_memory_id: "memory-1",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [], count: 0, maximum: 100, scope: "app" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ decided: true, decision: "approved" }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const proposed = await client.proposeMemoryReview({
      sourceText: "Prefiro respostas concisas.", key: "response_style", value: "Prefiro respostas concisas.",
    });
    expect(proposed.classification).toBe("possible_conflict");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ source_role: "user", key: "response_style" });
    await client.listMemoryReviews("app");
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/owner/memory/reviews?scope=app");
    await client.decideMemoryReview("proposal-1", "approve");
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({ proposal_id: "proposal-1", decision: "approve" });
    await expect(client.decideMemoryReview("", "approve")).rejects.toThrow("invalid_memory_proposal_id");
  });

  it("retrieves relevant curated memory without an inference call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      query: "estilo de resposta",
      memories: [{ memory_id: "memory-1", memory_key: "response_style", value: "Prefere respostas diretas." }],
      returned: 1, searched_records: 3, retrieval: "deterministic-keyword",
      inference_calls: 0, shared_memory_requires_explicit_grant: true,
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.retrieveMemory("estilo de resposta", 5);
    expect(result.inference_calls).toBe(0);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/memory/retrieve");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ query: "estilo de resposta", limit: 5 });
    await expect(client.retrieveMemory("x")).rejects.toThrow("invalid_memory_query");
    await expect(client.retrieveMemory("teste", 21)).rejects.toThrow("invalid_memory_limit");
  });

  it("requests bounded semantic synthesis for correlated task results", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-1", synthesis: "As fontes concordam no essencial.",
      sources: [{ app_id: "com.ciba.notes", status: "completed" }],
      input_characters: 120, model: "@cf/google/gemma-4-26b-a4b-it",
      intelligence: { strategy: "bounded-task-synthesis", provider: "cloudflare-workers-ai",
        inference_calls: 1, max_output_tokens: 384, zero_cost_model_approved: true },
    }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.synthesizeTaskResults("task-1");
    expect(result.intelligence.strategy).toBe("bounded-task-synthesis");
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/tasks/synthesize");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ task_id: "task-1" });
    await expect(client.synthesizeTaskResults("")).rejects.toThrow("invalid_task_id");
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

  it("maps owner app connection invitation methods to the authenticated API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ apps: [{ app_id: "com.ciba.app", display_name: "Ciba App" }] }), { status: 200 })
    );
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "owner-device-token", fetcher });
    await client.listAvailableApps();
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/owner/available-apps");
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer owner-device-token");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      app_id: "com.ciba.app", registration_invitation_code: "registration-code",
      pairing_invitation_code: "pairing-code", expires_at: "2030-01-01T00:00:00.000Z", note: "one-time",
    }), { status: 201 }));
    await client.createAppConnectionInvitation("com.ciba.app");
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/owner/apps/connect");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ app_id: "com.ciba.app" });
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

  it("validates an inbox task and exposes its context as untrusted data", () => {
    const client = new CibaClient({ baseUrl: "https://private.example" });
    const result = client.consumeTaskMessage({
      message_id: "message-1", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "task-1", scope: "task", created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z",
      payload: {
        protocol: "garcia.task.request", task_id: "task-1", task_type: "plan", instruction: "Planejar o projeto",
        context_package: {
          protocol: "garcia.context.package", version: 1, context_id: "ctx-1",
          purpose: "Contexto do projeto", conversation_history_included: false,
          items: [{ key: "project_phase", value: "Em revisão", kind: "project", origin: "curated_memory" }],
        },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.context.available).toBe(true);
    expect(result.context.trust).toBe("untrusted_data");
    expect(result.context.items[0].key).toBe("project_phase");
  });

  it("executes an app-owned task processor, submits the result, then acknowledges the inbox message", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1, requested: 1 }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const message = {
      message_id: "message-9", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "task-9", scope: "task" as const, created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z",
      payload: { protocol: "garcia.task.request", task_id: "task-9", task_type: "summarize", instruction: "Resumir documento" },
    };
    const result = await client.executeTaskMessage(message, async (consumption) => {
      expect(consumption.accepted).toBe(true);
      return { summary: "Resumo pronto" };
    });
    expect(result).toMatchObject({ taskId: "task-9", status: "completed", acknowledged: true, result: { summary: "Resumo pronto" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/tasks/results");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      task_id: "task-9", client_message_id: "task-result:task-9:message-9",
      status: "completed", result: { summary: "Resumo pronto" },
    });
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/apps/messages/ack");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ message_ids: ["message-9"] });
  });

  it("reports processor errors and acknowledges only after the failed result is accepted", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1, requested: 1 }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const message = {
      message_id: "message-10", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "task-10", scope: "task" as const, created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z",
      payload: { protocol: "garcia.task.request", task_id: "task-10", task_type: "analyze", instruction: "Analisar" },
    };
    const result = await client.executeTaskMessage(message, () => { throw new Error("Falha no processador"); });
    expect(result).toMatchObject({ status: "failed", result: { error: "Falha no processador" }, acknowledged: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ status: "failed" });
    expect(fetcher.mock.calls[1][0]).toBe("https://private.example/v1/apps/messages/ack");
  });

  it("lists only locally implemented task processors in a stable order", async () => {
    const { getRegisteredTaskTypes } = await import("../src/client");
    const processors = {
      summarize: async () => ({ summary: "ok" }),
      analyze: () => ({ analysis: "ok" }),
      draft: "not-a-function",
    } as unknown as import("../src/client").CibaTaskProcessorRegistry;
    expect(getRegisteredTaskTypes(processors)).toEqual(["analyze", "summarize"]);
  });

  it("does not execute or acknowledge a task type without a local processor", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const message = {
      message_id: "message-unsupported", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "task-unsupported", scope: "task" as const, created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z",
      payload: { protocol: "garcia.task.request", task_id: "task-unsupported", task_type: "summarize", instruction: "Resumir" },
    };
    await expect(client.executeRegisteredTaskMessage(message, {
      analyze: () => ({ analysis: "não deve executar" }),
    })).rejects.toThrow("task_type_not_supported_by_app");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("executes a registered task processor and reports only the supported type", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1, requested: 1 }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const message = {
      message_id: "message-registered", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "task-registered", scope: "task" as const, created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z",
      payload: { protocol: "garcia.task.request", task_id: "task-registered", task_type: "summarize", instruction: "Resumir" },
    };
    const processors: import("../src/client").CibaTaskProcessorRegistry = {
      summarize: ({ task }) => {
        if (!task) throw new Error("task_request_not_accepted");
        return { summary: task.instruction };
      },
    };
    const result = await client.executeRegisteredTaskMessage(message, processors);
    expect(result.status).toBe("completed");
    expect(result.result).toEqual({ summary: "Resumir" });
    const { getRegisteredTaskTypes } = await import("../src/client");
    expect(getRegisteredTaskTypes(processors)).toEqual(["summarize"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("processes a bounded inbox page using only registered task processors", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [
        { message_id: "m1", source_app_id: "a", destination_app_id: "b", task_id: "t1", scope: "task", created_at: "now", expires_at: "later", payload: { protocol: "garcia.task.request", task_id: "t1", task_type: "summarize", instruction: "Resumo" } },
        { message_id: "m2", source_app_id: "a", destination_app_id: "b", task_id: "t2", scope: "task", created_at: "now", expires_at: "later", payload: { protocol: "garcia.task.request", task_id: "t2", task_type: "analyze", instruction: "Analisar" } },
        { message_id: "m3", source_app_id: "a", destination_app_id: "b", task_id: "t3", scope: "context", created_at: "now", expires_at: "later", payload: {} },
      ], count: 3, maximum: 50 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1, requested: 1 }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.processTaskInbox({ summarize: ({ task }) => ({ summary: task?.instruction ?? "" }) }, 5);
    expect(result).toMatchObject({ fetched: 3, executed: 1, completed: 1, failed: 0, skipped: 2, delivery_errors: 0 });
    expect(result.outcomes.map((item) => item.status)).toEqual(["completed", "skipped_unsupported", "skipped_non_task"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe("https://private.example/v1/apps/messages/inbox?limit=5");
  });

  it("continues to later inbox tasks after a result-delivery error and validates limits", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [
        { message_id: "m1", source_app_id: "a", destination_app_id: "b", task_id: "t1", scope: "task", created_at: "now", expires_at: "later", payload: { protocol: "garcia.task.request", task_id: "t1", task_type: "summarize", instruction: "Primeira" } },
        { message_id: "m2", source_app_id: "a", destination_app_id: "b", task_id: "t2", scope: "task", created_at: "now", expires_at: "later", payload: { protocol: "garcia.task.request", task_id: "t2", task_type: "summarize", instruction: "Segunda" } },
      ], count: 2, maximum: 50 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary_failure" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1, requested: 1 }), { status: 200 }));
    const client = new CibaClient({ baseUrl: "https://private.example", getAccessToken: () => "device-token", fetcher });
    const result = await client.processTaskInbox({ summarize: ({ task }) => ({ summary: task?.instruction ?? "" }) });
    expect(result).toMatchObject({ fetched: 2, executed: 1, completed: 1, delivery_errors: 1 });
    expect(result.outcomes.map((item) => item.status)).toEqual(["delivery_error", "completed"]);
    await expect(client.processTaskInbox({}, 0)).rejects.toThrow("invalid_task_inbox_limit");
  });

  it("does not treat a context-scope inbox message as a task", () => {
    const client = new CibaClient({ baseUrl: "https://private.example" });
    const result = client.consumeTaskMessage({
      message_id: "message-2", source_app_id: "com.source", destination_app_id: "com.destination",
      task_id: "context-2", scope: "context", created_at: "2026-11-15T10:00:00.000Z",
      expires_at: "2026-11-16T10:00:00.000Z", payload: {},
    });
    expect(result.accepted).toBe(false);
    expect(result.errors).toContain("message_scope_is_not_task");
  });
});
