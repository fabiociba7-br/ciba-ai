import { sha256 } from "./crypto";

export const authenticateDevice = async (
  request: Request,
  env: { DB: D1Database },
) => {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length < 32 || token.length > 256) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    "SELECT device_id, app_id, owner_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first<{ device_id: string; app_id: string; owner_id: string | null }>();
};
