export type AppAccessEnv = {
  DB: D1Database;
  ALLOWED_APP_IDS?: string;
};

export const allowedApps = (env: Pick<AppAccessEnv, "ALLOWED_APP_IDS">) =>
  new Set((env.ALLOWED_APP_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));

export const isAppAllowed = async (env: AppAccessEnv, appId: string): Promise<boolean> => {
  const row = await env.DB.prepare(
    "SELECT enabled FROM app_registry WHERE app_id = ?"
  ).bind(appId).first<{ enabled: number }>();
  if (row) return row.enabled === 1;
  return allowedApps(env).has(appId);
};
