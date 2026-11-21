import { json } from "./responses";
import { readJson } from "./request";
import { authenticateDevice } from "../security/device-auth";
import { randomToken, sha256, nowIso } from "../security/crypto";
import { getActiveOwnerForDevice } from "../core/owner-access";
import { isAppAllowed } from "../core/apps/access";
import {
  parseStoredAppCapabilities,
  parseStoredAppTaskTypes,
} from "../core/apps/registry";
import { isValidAppId } from "../policy";

export type OwnerAppsEnv = {
  DB: D1Database;
  ALLOWED_APP_IDS?: string;
};

export const handleOwnerAvailableApps = async (
  request: Request,
  env: OwnerAppsEnv,
) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const rows = await env.DB.prepare(
    "SELECT app_id, display_name FROM app_registry WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE"
  ).all<{ app_id: string; display_name: string }>();
  const apps = (rows.results || []).filter((app) => isValidAppId(app.app_id));
  return json({ apps });
};

export const handleConnectOwnerApp = async (
  request: Request,
  env: OwnerAppsEnv,
) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const body = await readJson(request, 4_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!isValidAppId(appId) || !(await isAppAllowed(env, appId))) {
    return json({ error: "app_not_allowed" }, 400);
  }
  const app = await env.DB.prepare(
    "SELECT app_id FROM app_registry WHERE app_id = ? AND enabled = 1"
  ).bind(appId).first<{ app_id: string }>();
  if (!app) return json({ error: "app_not_available" }, 404);
  const registrationCode = randomToken(24);
  const pairingCode = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO invitations(code_hash, app_id, created_at, expires_at) VALUES(?, ?, ?, ?)")
      .bind(await sha256(registrationCode), appId, createdAt, expiresAt),
    env.DB.prepare("INSERT INTO owner_pairing_invitations(code_hash, owner_id, app_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?)")
      .bind(await sha256(pairingCode), owner.owner_id, appId, createdAt, expiresAt),
  ]);
  if ((results[0]?.meta?.changes || 0) !== 1 || (results[1]?.meta?.changes || 0) !== 1) {
    return json({ error: "app_connection_invitation_failed" }, 500);
  }
  return json({
    app_id: appId,
    registration_invitation_code: registrationCode,
    pairing_invitation_code: pairingCode,
    expires_at: expiresAt,
    note: "Each code is shown only once. Register the device with the first code, then pair it with the second code.",
  }, 201);
};

export const handleAppIdentity = async (
  request: Request,
  env: OwnerAppsEnv,
) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const app = await env.DB.prepare(
    "SELECT app_id, display_name, enabled, description, app_type, capabilities_json, task_types_json, contract_version FROM app_registry WHERE app_id = ?"
  ).bind(device.app_id).first<{
    app_id: string;
    display_name: string;
    enabled: number;
    description: string;
    app_type: string;
    capabilities_json: string;
    task_types_json: string;
    contract_version: string;
  }>();
  if (!app) return json({ error: "app_profile_not_found" }, 404);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  const connectedApps = owner ? await env.DB.prepare(`
    SELECT a.app_id, a.display_name, a.description, a.app_type,
      a.capabilities_json, a.task_types_json, a.contract_version,
      COUNT(DISTINCT d.device_id) AS active_device_count
    FROM devices d
    INNER JOIN app_registry a ON a.app_id = d.app_id
    WHERE d.owner_id = ? AND d.revoked_at IS NULL AND a.enabled = 1
    GROUP BY a.app_id, a.display_name, a.description, a.app_type,
      a.capabilities_json, a.task_types_json, a.contract_version
    ORDER BY a.display_name COLLATE NOCASE
  `).bind(owner.owner_id).all<{
    app_id: string;
    display_name: string;
    description: string;
    app_type: string;
    capabilities_json: string;
    task_types_json: string;
    contract_version: string;
    active_device_count: number;
  }>() : { results: [] };
  return json({
    contract: "garcia-app",
    contract_version: app.contract_version,
    identity: {
      app_id: app.app_id,
      display_name: app.display_name,
      enabled: app.enabled === 1,
      description: app.description,
      app_type: app.app_type,
      capabilities: parseStoredAppCapabilities(app.capabilities_json),
      task_types: parseStoredAppTaskTypes(app.task_types_json),
    },
    device: { device_id: device.device_id, owner_linked: Boolean(owner) },
    connected_apps: (connectedApps.results || []).map((item) => ({
      app_id: item.app_id,
      display_name: item.display_name,
      description: item.description,
      app_type: item.app_type,
      capabilities: parseStoredAppCapabilities(item.capabilities_json),
      task_types: parseStoredAppTaskTypes(item.task_types_json),
      contract_version: item.contract_version,
      active_device_count: item.active_device_count,
    })),
    capability_semantics: {
      descriptive_only: true,
      grants_required_for_cross_app_access: true,
      app_actions_executable_by_garcia: false,
    },
  });
};
