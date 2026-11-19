import { json } from "../http/responses";
import { sha256, nowIso } from "./crypto";
import { MAX_ADMIN_AUTH_FAILURES_PER_MINUTE } from "../policy";

export interface AdminAuthEnv {
  DB: D1Database;
  ADMIN_TOKEN: string;
}

export const authorizeAdmin = async (
  request: Request,
  env: AdminAuthEnv,
): Promise<Response | null> => {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
    return json({ error: "admin_auth_not_configured" }, 503);
  }

  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const candidate = supplied.length <= 256 ? supplied : "";
  const [expectedHash, candidateHash] = await Promise.all([
    sha256(env.ADMIN_TOKEN),
    sha256(candidate),
  ]);

  // Compare fixed-length digests to avoid leaking a matching token prefix.
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ candidateHash.charCodeAt(index);
  }
  if (difference === 0 && supplied.length > 0) return null;

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(`${ip}:${env.ADMIN_TOKEN}`);
  const minute = new Date().toISOString().slice(0, 16);
  try {
    await env.DB.prepare(`
      INSERT INTO admin_auth_usage(minute, ip_hash, attempts, attempt_limit, updated_at)
      VALUES(?, ?, 1, ?, ?)
      ON CONFLICT(minute, ip_hash) DO UPDATE SET
        attempts = admin_auth_usage.attempts + 1,
        attempt_limit = excluded.attempt_limit,
        updated_at = excluded.updated_at
    `).bind(minute, ipHash, MAX_ADMIN_AUTH_FAILURES_PER_MINUTE, nowIso()).run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("admin_auth_rate_exceeded")) {
      return json({ error: "admin_auth_rate_limited", retry_after_seconds: 60 }, 429, { "retry-after": "60" });
    }
    throw error;
  }

  return json({ error: "unauthorized" }, 401);
};
