import { json } from "./responses";
import { readJson } from "./request";
import { nowIso } from "../security/crypto";
import { authenticateDevice } from "../security/device-auth";
import { getActiveOwnerForDevice } from "../core/owner-access";
import { facebookCapabilities } from "../core/facebook/capabilities";
import { decryptFacebookToken, encryptFacebookToken, facebookGraphGet } from "../facebook";

export type FacebookOwnerEnv = {
  DB: D1Database;
  FACEBOOK_APP_SECRET?: string;
};

export const handleOwnerFacebookStatus = async (request: Request, env: FacebookOwnerEnv) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const link = await env.DB.prepare(
    "SELECT facebook_user_id, linked_at, token_expires_at, permissions_json, profile_json, token_ciphertext FROM owner_facebook_links WHERE owner_id = ?"
  ).bind(owner.owner_id).first<{
    facebook_user_id: string; linked_at: string; token_expires_at: string | null;
    permissions_json: string; profile_json: string; token_ciphertext: string | null;
  }>();
  let permissions: string[] = [];
  let profile: Record<string, unknown> = {};
  try { permissions = JSON.parse(link?.permissions_json || "[]"); } catch { permissions = []; }
  try { profile = JSON.parse(link?.profile_json || "{}"); } catch { profile = {}; }
  return json({
    linked: Boolean(link),
    linked_at: link?.linked_at || null,
    token_stored: Boolean(link?.token_ciphertext),
    token_expires_at: link?.token_expires_at || null,
    permissions,
    capabilities: facebookCapabilities(permissions),
    profile,
    requires_reconnect: Boolean(link && !link.token_ciphertext),
  });
};

export const handleOwnerFacebookLink = async (request: Request, env: FacebookOwnerEnv) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  if (device.app_id !== "com.ciba.garcia") return json({ error: "garcia_app_required" }, 403);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!env.FACEBOOK_APP_SECRET) return json({ error: "facebook_server_not_configured" }, 503);

  const body = await readJson(request, 8_000);
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (accessToken.length < 20 || accessToken.length > 4_000) {
    return json({ error: "invalid_facebook_access_token" }, 400);
  }
  let appAccessToken = "";
  try {
    const appTokenUrl = new URL("https://graph.facebook.com/v27.0/oauth/access_token");
    appTokenUrl.searchParams.set("client_id", "1395601549081486");
    appTokenUrl.searchParams.set("client_secret", env.FACEBOOK_APP_SECRET.trim());
    appTokenUrl.searchParams.set("grant_type", "client_credentials");
    const appTokenResponse = await fetch(appTokenUrl);
    const appTokenBody = await appTokenResponse.json().catch(() => null) as { access_token?: string } | null;
    if (!appTokenResponse.ok || !appTokenBody?.access_token) {
      return json({ error: "facebook_app_access_token_failed" }, 502);
    }
    appAccessToken = appTokenBody.access_token;
  } catch {
    return json({ error: "facebook_app_token_service_unavailable" }, 502);
  }

  const debugUrl = new URL("https://graph.facebook.com/v27.0/debug_token");
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", appAccessToken);
  let tokenData: { app_id?: string; is_valid?: boolean; user_id?: string; expires_at?: number; data_access_expires_at?: number };
  try {
    const response = await fetch(debugUrl);
    const result = await response.json().catch(() => null) as { data?: typeof tokenData } | null;
    if (!response.ok || !result?.data) return json({ error: "facebook_token_verification_failed" }, 401);
    tokenData = result.data;
  } catch {
    return json({ error: "facebook_verification_unavailable" }, 502);
  }
  if (tokenData.is_valid !== true || tokenData.app_id !== "1395601549081486" ||
      typeof tokenData.user_id !== "string" || !/^\d{5,32}$/.test(tokenData.user_id) ||
      (tokenData.expires_at && tokenData.expires_at <= Math.floor(Date.now() / 1000))) {
    return json({ error: "invalid_facebook_access_token" }, 401);
  }

  // Exchange short-lived user tokens for long-lived tokens where Meta permits it.
  let storedToken = accessToken;
  let expiresAt = Number(tokenData.expires_at || 0) || null;
  try {
    const exchangeUrl = new URL("https://graph.facebook.com/v27.0/oauth/access_token");
    exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchangeUrl.searchParams.set("client_id", "1395601549081486");
    exchangeUrl.searchParams.set("client_secret", env.FACEBOOK_APP_SECRET.trim());
    exchangeUrl.searchParams.set("fb_exchange_token", accessToken);
    const exchangeResponse = await fetch(exchangeUrl);
    const exchanged = await exchangeResponse.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
    if (exchangeResponse.ok && exchanged?.access_token) {
      storedToken = exchanged.access_token;
      expiresAt = typeof exchanged.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + exchanged.expires_in : expiresAt;
    }
  } catch {
    // Keep the verified original token; status exposes its actual expiry.
  }

  const graphDiagnostic = (error: unknown) => {
    const failure = error as {
      status?: unknown; code?: unknown; subcode?: unknown; type?: unknown;
    };
    return {
      graph_http_status: typeof failure?.status === "number" ? failure.status : null,
      graph_error_code: typeof failure?.code === "number" ? failure.code : null,
      graph_error_subcode: typeof failure?.subcode === "number" ? failure.subcode : null,
      graph_error_type: typeof failure?.type === "string" ? failure.type.slice(0, 80) : null,
    };
  };

  let profile: Record<string, unknown>;
  try {
    profile = await facebookGraphGet<Record<string, unknown>>("me", storedToken, { fields: "id,name" });
  } catch (error) {
    const details = graphDiagnostic(error);
    return json({
      error: "facebook_profile_request_failed",
      facebook_graph_error: {
        http_status: details.graph_http_status,
        code: details.graph_error_code,
        subcode: details.graph_error_subcode,
        type: details.graph_error_type,
      },
      diagnostic: details,
    }, 502);
  }
  if (profile.id !== tokenData.user_id) {
    return json({ error: "facebook_identity_mismatch" }, 401);
  }

  let permissions: string[];
  try {
    const permissionResult = await facebookGraphGet<{ data?: Array<{ permission?: string; status?: string }> }>(
      "me/permissions", storedToken,
    );
    permissions = (permissionResult.data || [])
      .filter((item) => item.status === "granted" && typeof item.permission === "string")
      .map((item) => item.permission!);
  } catch (error) {
    return json({
      error: "facebook_permissions_request_failed",
      diagnostic: graphDiagnostic(error),
    }, 502);
  }

  const alreadyLinked = await env.DB.prepare(
    "SELECT owner_id FROM owner_facebook_links WHERE facebook_user_id = ?"
  ).bind(tokenData.user_id).first<{ owner_id: string }>();
  if (alreadyLinked && alreadyLinked.owner_id !== owner.owner_id) {
    return json({ error: "facebook_account_already_linked" }, 409);
  }
  const currentLink = await env.DB.prepare(
    "SELECT facebook_user_id FROM owner_facebook_links WHERE owner_id = ?"
  ).bind(owner.owner_id).first<{ facebook_user_id: string }>();
  if (currentLink && currentLink.facebook_user_id !== tokenData.user_id) {
    return json({ error: "facebook_already_linked_to_another_account" }, 409);
  }

  const encrypted = await encryptFacebookToken({ access_token: storedToken, expires_at: expiresAt }, env.FACEBOOK_APP_SECRET);
  const linkedAt = nowIso();
  try {
    if (currentLink) {
      await env.DB.prepare(`
        UPDATE owner_facebook_links SET
          token_ciphertext = ?, token_iv = ?, token_salt = ?, token_expires_at = ?,
          permissions_json = ?, profile_json = ?, linked_at = ?
        WHERE owner_id = ? AND facebook_user_id = ?
      `).bind(
        encrypted.ciphertext, encrypted.iv, encrypted.salt,
        expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        JSON.stringify(permissions), JSON.stringify(profile), linkedAt,
        owner.owner_id, tokenData.user_id,
      ).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO owner_facebook_links(
          owner_id, facebook_user_id, linked_at, token_ciphertext, token_iv, token_salt,
          token_expires_at, permissions_json, profile_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        owner.owner_id, tokenData.user_id, linkedAt,
        encrypted.ciphertext, encrypted.iv, encrypted.salt,
        expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        JSON.stringify(permissions), JSON.stringify(profile),
      ).run();
    }
  } catch {
    return json({ error: "facebook_link_conflict" }, 409);
  }
  return json({
    linked: true, linked_at: linkedAt, token_stored: true,
    token_expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    profile, permissions, capabilities: facebookCapabilities(permissions),
  });
};

export const handleOwnerFacebookData = async (request: Request, env: FacebookOwnerEnv, url: URL) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  if (device.app_id !== "com.ciba.garcia") return json({ error: "garcia_app_required" }, 403);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!env.FACEBOOK_APP_SECRET) return json({ error: "facebook_server_not_configured" }, 503);
  const link = await env.DB.prepare(`
    SELECT token_ciphertext, token_iv, token_salt, token_expires_at, permissions_json
    FROM owner_facebook_links WHERE owner_id = ?
  `).bind(owner.owner_id).first<{
    token_ciphertext: string | null; token_iv: string | null; token_salt: string | null;
    token_expires_at: string | null; permissions_json: string | null;
  }>();
  if (!link) return json({ error: "facebook_not_linked" }, 404);
  if (!link.token_ciphertext || !link.token_iv || !link.token_salt) {
    return json({ error: "facebook_reconnect_required" }, 409);
  }
  if (link.token_expires_at && Date.parse(link.token_expires_at) <= Date.now()) {
    return json({ error: "facebook_token_expired", reconnect_required: true }, 401);
  }
  let permissions: string[] = [];
  try { permissions = JSON.parse(link.permissions_json || "[]"); } catch { permissions = []; }
  let token: string;
  try {
    const bundle = await decryptFacebookToken({
      token_ciphertext: link.token_ciphertext, token_iv: link.token_iv, token_salt: link.token_salt,
    }, env.FACEBOOK_APP_SECRET);
    token = bundle.access_token;
  } catch {
    return json({ error: "facebook_token_decryption_failed", reconnect_required: true }, 503);
  }

  const path = url.pathname.split("/").pop() || "";
  const limit = String(Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 50));
  const diagnostic = (error: unknown) => {
    const failure = error as { status?: number; code?: number; subcode?: number; type?: string };
    return {
      http_status: typeof failure?.status === "number" ? failure.status : null,
      code: typeof failure?.code === "number" ? failure.code : null,
      subcode: typeof failure?.subcode === "number" ? failure.subcode : null,
      type: typeof failure?.type === "string" ? failure.type : null,
    };
  };
  const needs = (permission: string) => permissions.includes(permission);
  try {
    if (path === "profile") {
      const fields = ["id", "name", "picture"];
      if (needs("email")) fields.push("email");
      if (needs("user_birthday")) fields.push("birthday");
      if (needs("user_age_range")) fields.push("age_range");
      if (needs("user_gender")) fields.push("gender");
      if (needs("user_hometown")) fields.push("hometown");
      if (needs("user_location")) fields.push("location");
      if (needs("user_link")) fields.push("link");
      const profile = await facebookGraphGet("me", token, { fields: fields.join(",") });
      return json({ profile, source: "facebook_graph_api", checked_at: nowIso() });
    }
    if (path === "permissions") {
      const current = await facebookGraphGet<{ data?: Array<{ permission?: string; status?: string }> }>("me/permissions", token);
      const granted = (current.data || []).filter(item => item.status === "granted");
      return json({ data: current.data || [], granted, capabilities: facebookCapabilities(granted.map(item => item.permission || "")) });
    }
    if (path === "posts") {
      if (!needs("user_posts")) return json({ error: "facebook_permission_missing", permission: "user_posts" }, 403);
      const posts = await facebookGraphGet("me/posts", token, {
        fields: "id,message,story,created_time,updated_time,permalink_url,full_picture,attachments{media_type,type,url,title,target,subattachments}",
        limit,
      });
      return json({ posts, source: "facebook_graph_api", checked_at: nowIso() });
    }
    if (path === "photos") {
      if (!needs("user_photos") && !needs("user_posts")) {
        return json({ error: "facebook_permission_missing", permission: "user_photos" }, 403);
      }
      const photos = await facebookGraphGet("me/photos", token, {
        type: "uploaded",
        fields: "id,name,created_time,updated_time,link,images,album",
        limit,
      });
      return json({ photos, source: "facebook_graph_api", checked_at: nowIso() });
    }
    if (path === "videos") {
      if (!needs("user_videos")) return json({ error: "facebook_permission_missing", permission: "user_videos" }, 403);
      // Meta's current User Videos reference does not expose a read operation.
      // Attempt the edge anyway so the account's actual API response is recorded;
      // posts can still expose video attachments through /me/posts.
      try {
        const videos = await facebookGraphGet("me/videos", token, {
          fields: "id,description,created_time,updated_time,picture,permalink_url",
          limit,
        });
        return json({ videos, source: "facebook_graph_api", checked_at: nowIso(), availability: "available" });
      } catch (error) {
        return json({
          videos: { data: [] }, availability: "not_supported_by_current_user_videos_edge",
          note: "A API atual não oferece leitura direta pela borda /me/videos. Vídeos que apareçam como anexos das publicações podem ser identificados em /posts.",
          diagnostic: diagnostic(error), checked_at: nowIso(),
        });
      }
    }
    if (path === "comments") {
      const postId = url.searchParams.get("post_id") || "";
      if (!/^\d{5,32}_\d{5,40}$/.test(postId) && !/^\d{10,40}$/.test(postId)) {
        return json({ error: "valid_post_id_required" }, 400);
      }
      if (!needs("user_posts")) return json({ error: "facebook_permission_missing", permission: "user_posts" }, 403);
      const comments = await facebookGraphGet(`${postId}/comments`, token, {
        fields: "id,message,created_time,from,comment_count,like_count",
        summary: "true", filter: "stream", limit,
      });
      return json({
        comments, availability: (comments as { data?: unknown[] }).data?.length
          ? "some_comments_returned" : "meta_user_token_comment_visibility_limited",
        note: "A Meta limita a leitura de comentários e dados de outros usuários em publicações de perfil pessoal.",
        checked_at: nowIso(),
      });
    }
    if (path === "summary") {
      const profile = await facebookGraphGet("me", token, { fields: "id,name,picture" });
      const [posts, photos] = await Promise.all([
        needs("user_posts")
          ? facebookGraphGet("me/posts", token, { fields: "id,message,story,created_time,permalink_url", limit: "10" }).catch(error => ({ error: "posts_unavailable", diagnostic: diagnostic(error) }))
          : Promise.resolve({ error: "permission_not_granted", permission: "user_posts" }),
        (needs("user_photos") || needs("user_posts"))
          ? facebookGraphGet("me/photos", token, { type: "uploaded", fields: "id,name,created_time,link", limit: "10" }).catch(error => ({ error: "photos_unavailable", diagnostic: diagnostic(error) }))
          : Promise.resolve({ error: "permission_not_granted", permission: "user_photos" }),
      ]);
      return json({
        profile, posts, photos,
        permissions,
        capabilities: facebookCapabilities(permissions),
        limitations: {
          comments: "A Meta pode ocultar comentários feitos por outras pessoas em posts de perfil pessoal.",
          messenger: "A API documentada não oferece acesso à caixa de entrada pessoal do Messenger.",
          videos: "A borda atual /me/videos não oferece leitura direta; anexos de vídeo podem aparecer nos posts.",
        },
        checked_at: nowIso(),
      });
    }
    return json({ error: "unsupported_facebook_resource" }, 404);
  } catch (error) {
    return json({ error: "facebook_graph_request_failed", facebook_graph_error: diagnostic(error) }, 502);
  }
};
