import { json } from "../http/responses";

export const requireCibaGenioAccess = async (
  env: { DB: D1Database },
  resourceId: string,
  appId?: string,
): Promise<Response | null> => {
  const control = await env.DB.prepare(`
    SELECT enabled, scope FROM cibagenio_controls
    WHERE resource_id = ?
      AND ((scope = 'app' AND scope_id = ?) OR (scope = 'global' AND scope_id = ''))
    ORDER BY CASE WHEN scope = 'app' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(resourceId, appId || "").first<{ enabled: number; scope: string }>();
  if (control?.enabled === 1) return null;
  return json({
    error: "resource_locked_by_cibagenio",
    resource_id: resourceId,
    scope: control?.scope || "global",
  }, 403);
};
