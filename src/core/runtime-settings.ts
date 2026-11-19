import { getLimit, resolveModel, MAX_OUTPUT_TOKENS } from "../policy";

export type RuntimeSettingsEnv = {
  DB: D1Database;
  AI_MODEL?: string;
  MAX_OUTPUT_TOKENS?: string;
};

export const readRuntimeSettings = async (
  env: Pick<RuntimeSettingsEnv, "DB">,
): Promise<Record<string, string>> => {
  const rows = await env.DB.prepare("SELECT setting_key, setting_value FROM runtime_settings").all<{
    setting_key: string; setting_value: string;
  }>();
  return Object.fromEntries((rows.results || []).map((row) => [row.setting_key, row.setting_value]));
};

export const CONFIG_KEYS = new Set([
  "ai_enabled", "ai_model", "max_output_tokens", "maintenance_mode",
]);

export const publicConfig = (
  settings: Record<string, string>,
  env: Pick<RuntimeSettingsEnv, "AI_MODEL" | "MAX_OUTPUT_TOKENS">,
) => ({
  service: "ciba-ai",
  ai_enabled: settings.ai_enabled !== "false" && Boolean(resolveModel(settings.ai_model, env.AI_MODEL)),
  model: resolveModel(settings.ai_model, env.AI_MODEL),
  maintenance_mode: settings.maintenance_mode === "true",
  limits: {
    daily_requests: null,
    requests_per_minute: null,
    max_output_tokens: Math.min(getLimit(settings.max_output_tokens || env.MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS),
  },
});
