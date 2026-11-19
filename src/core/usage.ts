import { utcDay } from "../security/crypto";

export const usageFor = async (
  env: { DB: D1Database },
  appId: string,
  deviceId: string,
) => {
  const day = utcDay();
  const rows = await env.DB.prepare(
    "SELECT scope_key, requests, request_limit FROM daily_usage WHERE day = ? AND scope_key IN ('global', ?, ?)"
  ).bind(day, `app:${appId}`, `device:${deviceId}`).all<{
    scope_key: string; requests: number; request_limit: number;
  }>();
  return { day, buckets: rows.results || [] };
};
