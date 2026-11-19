import { describe, expect, it, vi } from "vitest";
import { CONFIG_KEYS, publicConfig, readRuntimeSettings } from "../src/core/runtime-settings";

describe("runtime settings", () => {
  it("reads settings from D1 and returns an empty object when no rows exist", async () => {
    const all = vi.fn().mockResolvedValue({ results: [
      { setting_key: "ai_enabled", setting_value: "true" },
      { setting_key: "maintenance_mode", setting_value: "false" },
    ] });
    const prepare = vi.fn().mockReturnValue({ all });
    await expect(readRuntimeSettings({ DB: { prepare } as unknown as D1Database })).resolves.toEqual({
      ai_enabled: "true",
      maintenance_mode: "false",
    });
    expect(prepare).toHaveBeenCalledWith("SELECT setting_key, setting_value FROM runtime_settings");

    all.mockResolvedValueOnce({ results: undefined });
    await expect(readRuntimeSettings({ DB: { prepare } as unknown as D1Database })).resolves.toEqual({});
  });

  it("exposes only the supported configurable keys", () => {
    expect([...CONFIG_KEYS]).toEqual([
      "ai_enabled", "ai_model", "max_output_tokens", "maintenance_mode",
    ]);
  });

  it("builds public config using the resolved model and bounded output limit", () => {
    expect(publicConfig(
      { ai_enabled: "true", ai_model: "@cf/google/gemma-4-26b-a4b-it", max_output_tokens: "900" },
      { MAX_OUTPUT_TOKENS: "400" },
    )).toEqual({
      service: "ciba-ai",
      ai_enabled: true,
      model: "@cf/google/gemma-4-26b-a4b-it",
      maintenance_mode: false,
      limits: { daily_requests: null, requests_per_minute: null, max_output_tokens: 512 },
    });
  });

  it("disables AI for an unsupported model and honors maintenance mode", () => {
    expect(publicConfig(
      { ai_enabled: "true", ai_model: "unapproved-model", maintenance_mode: "true" },
      {},
    )).toMatchObject({ ai_enabled: false, model: null, maintenance_mode: true });
  });

  it("uses environment model fallback and clamps invalid output limits to the default", () => {
    expect(publicConfig(
      { max_output_tokens: "0" },
      { AI_MODEL: "@cf/google/gemma-4-26b-a4b-it" },
    )).toMatchObject({
      ai_enabled: true,
      model: "@cf/google/gemma-4-26b-a4b-it",
      limits: { max_output_tokens: 512 },
    });
  });
});
