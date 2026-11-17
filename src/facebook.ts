export type FacebookTokenBundle = {
  access_token: string;
  token_type?: string;
  expires_at?: number | null;
};

const encoder = new TextEncoder();
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

const deriveEncryptionKey = async (appSecret: string, salt: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(appSecret.trim()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: asArrayBuffer(salt), info: asArrayBuffer(encoder.encode("ciba-ai/facebook-token-storage/v1")) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const encryptFacebookToken = async (bundle: FacebookTokenBundle, appSecret: string) => {
  if (!appSecret.trim()) throw new Error("facebook_encryption_unavailable");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(appSecret, salt);
  const plaintext = encoder.encode(JSON.stringify(bundle));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(plaintext));
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv), salt: toBase64(salt) };
};

export const decryptFacebookToken = async (
  record: { token_ciphertext: string; token_iv: string; token_salt: string },
  appSecret: string,
): Promise<FacebookTokenBundle> => {
  if (!appSecret.trim()) throw new Error("facebook_encryption_unavailable");
  const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const salt = fromBase64(record.token_salt);
  const iv = fromBase64(record.token_iv);
  const key = await deriveEncryptionKey(appSecret, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(fromBase64(record.token_ciphertext)));
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as FacebookTokenBundle;
  if (!parsed || typeof parsed.access_token !== "string" || parsed.access_token.length < 20) {
    throw new Error("facebook_token_record_invalid");
  }
  return parsed;
};

export const facebookGraphGet = async <T = Record<string, unknown>>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> => {
  const url = new URL(`https://graph.facebook.com/v27.0/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string; code?: number; error_subcode?: number; type?: string } }) | null;
  if (!response.ok || !body || body.error) {
    const error = body && "error" in body ? body.error : undefined;
    const failure = new Error("facebook_graph_request_failed");
    Object.assign(failure, {
      status: response.status,
      code: error?.code ?? null,
      subcode: error?.error_subcode ?? null,
      type: typeof error?.type === "string" ? error.type.slice(0, 80) : null,
      message: typeof error?.message === "string" ? error.message.slice(0, 180) : null,
    });
    throw failure;
  }
  return body;
};
