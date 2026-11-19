export interface OwnerFeatureSettings {
  memory_enabled: boolean;
  app_messaging_enabled: boolean;
}

export const getActiveOwnerForDevice = async (
  env: { DB: D1Database },
  ownerId: string | null,
) => {
  if (!ownerId) return null;
  return env.DB.prepare(
    "SELECT owner_id FROM owners WHERE owner_id = ? AND status = 'active'"
  ).bind(ownerId).first<{ owner_id: string }>();
};

export const readOwnerFeatureSettings = async (
  env: { DB: D1Database },
  ownerId: string,
): Promise<OwnerFeatureSettings> => {
  const row = await env.DB.prepare(
    "SELECT memory_enabled, app_messaging_enabled FROM owner_settings WHERE owner_id = ?"
  ).bind(ownerId).first<{ memory_enabled: number; app_messaging_enabled: number }>();
  return {
    memory_enabled: row?.memory_enabled === 1,
    app_messaging_enabled: row?.app_messaging_enabled === 1,
  };
};
