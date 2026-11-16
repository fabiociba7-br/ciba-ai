import type { ChatTurn } from "./types";

export type MemoryPermission = "read" | "write";
export type MemoryScope =
  | { type: "owner"; ownerId: string }
  | { type: "app"; ownerId: string; appId: string };

export type MemoryConsent = "disabled" | "curated";

export interface MemoryGrant {
  ownerId: string;
  granteeAppId: string;
  scope: "owner" | "app";
  sourceAppId?: string;
  permissions: MemoryPermission[];
  expiresAt?: number;
}

export interface MemoryRecord {
  id: string;
  ownerId: string;
  scope: MemoryScope;
  value: string;
  createdAt: number;
  expiresAt?: number;
  createdByAppId: string;
}

export interface MemoryAccessRequest {
  ownerId: string;
  requesterAppId: string;
  permission: MemoryPermission;
  target: MemoryScope;
}

export interface MemoryStore {
  list(request: MemoryAccessRequest): Promise<MemoryRecord[]>;
  put(request: MemoryAccessRequest, record: MemoryRecord): Promise<void>;
  delete(request: MemoryAccessRequest, recordId: string): Promise<void>;
}

/**
 * Current-request context only. It deliberately does not persist conversation
 * turns or create memories automatically.
 */
export function buildWorkingContext(messages: ChatTurn[]): ChatTurn[] {
  const entries = snapshotMemoryArray(messages, 100);
  if (!entries) throw new Error("invalid_memory_context");
  return entries.map((entry) => {
    const fields = snapshotMemoryRecord(entry, ["role", "content"]);
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, "role") ||
        !Object.prototype.hasOwnProperty.call(fields, "content") ||
        (fields.role !== "user" && fields.role !== "assistant") ||
        typeof fields.content !== "string" || fields.content.length > 32_000) {
      throw new Error("invalid_memory_context");
    }
    return Object.freeze({
      role: fields.role,
      content: fields.content,
    }) as ChatTurn;
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function snapshotMemoryRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function snapshotMemoryArray(value: unknown, maxLength = 256): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > maxLength) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

export function canAccessMemory(
  request: MemoryAccessRequest,
  grants: MemoryGrant[],
  now = Date.now()
): boolean {
  try {
    const safeRequest = snapshotMemoryRecord(request, [
      "ownerId", "requesterAppId", "permission", "target"
    ]);
    const target = safeRequest ? snapshotMemoryRecord(safeRequest.target, [
      "type", "ownerId", "appId"
    ]) : null;
    const safeGrants = snapshotMemoryArray(grants);
    if (!safeRequest || !target || !safeGrants ||
        !isNonEmptyString(safeRequest.ownerId) ||
        !isNonEmptyString(safeRequest.requesterAppId) ||
        (safeRequest.permission !== "read" && safeRequest.permission !== "write") ||
        !isNonEmptyString(target.ownerId) ||
        target.ownerId !== safeRequest.ownerId ||
        !Number.isFinite(now)) return false;

    const targetType = target.type;
    const targetAppId = target.appId;
    if (targetType === "owner") {
      if (targetAppId !== undefined) return false;
    } else if (targetType !== "app" || !isNonEmptyString(targetAppId)) {
      return false;
    }

    if (targetType === "app" && targetAppId === safeRequest.requesterAppId) return true;

    return safeGrants.some((rawGrant) => {
      const grant = snapshotMemoryRecord(rawGrant, [
        "ownerId", "granteeAppId", "scope", "sourceAppId", "permissions", "expiresAt"
      ]);
      if (!grant) return false;
      const permissions = snapshotMemoryArray(grant.permissions, 8);
      if (!isNonEmptyString(grant.ownerId) ||
          !isNonEmptyString(grant.granteeAppId) ||
          (grant.scope !== "owner" && grant.scope !== "app") ||
          !permissions || permissions.length === 0 ||
          !permissions.every((permission) => permission === "read" || permission === "write") ||
          new Set(permissions).size !== permissions.length ||
          (grant.expiresAt !== undefined && !Number.isSafeInteger(grant.expiresAt)) ||
          (grant.scope === "app" && !isNonEmptyString(grant.sourceAppId)) ||
          (grant.scope === "owner" && grant.sourceAppId !== undefined)) return false;

      if (grant.ownerId !== safeRequest.ownerId ||
          grant.granteeAppId !== safeRequest.requesterAppId ||
          !permissions.includes(safeRequest.permission as MemoryPermission) ||
          (grant.expiresAt !== undefined && (grant.expiresAt as number) <= now)) return false;

      if (targetType === "owner") return grant.scope === "owner";
      return grant.scope === "app" && grant.sourceAppId === targetAppId;
    });
  } catch {
    return false;
  }
}

function readPlainDataObject(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || key === "__proto__" ||
          key === "constructor" || key === "prototype") return null;
      const descriptor = descriptors[key];
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Validates a persisted memory record before storage or retrieval. This is a
 * structural check; callers must still enforce canAccessMemory on every read
 * and write and bind the owner identity to the authenticated session.
 */
export function validateMemoryRecord(record: MemoryRecord): MemoryRecord {
  const source = readPlainDataObject(record);
  if (!source) throw new Error("invalid_memory_record");
  const scopeValue = readPlainDataObject(source.scope);
  if (!scopeValue) throw new Error("invalid_memory_record");

  const id = source.id;
  const ownerId = source.ownerId;
  const createdByAppId = source.createdByAppId;
  const valueInput = source.value;
  const createdAt = source.createdAt;
  const expiresAt = source.expiresAt;
  const scopeType = scopeValue.type;
  const scopeOwnerId = scopeValue.ownerId;
  const scopeAppId = scopeValue.appId;

  if (!isNonEmptyString(id) || id.length > 200 ||
      !isNonEmptyString(ownerId) || !isNonEmptyString(createdByAppId) ||
      !isNonEmptyString(scopeOwnerId) || scopeOwnerId !== ownerId ||
      (scopeType !== "owner" && scopeType !== "app") ||
      (scopeType === "app" && !isNonEmptyString(scopeAppId)) ||
      (scopeType === "owner" && scopeAppId !== undefined) ||
      !Number.isSafeInteger(createdAt) || (createdAt as number) <= 0 ||
      (expiresAt !== undefined &&
        (!Number.isSafeInteger(expiresAt) || (expiresAt as number) <= (createdAt as number)))) {
    throw new Error("invalid_memory_record");
  }

  let value: string;
  try {
    value = validateCuratedMemory({ consent: "curated", value: valueInput as string });
  } catch {
    throw new Error("invalid_memory_record");
  }
  const scope: MemoryScope = Object.freeze(scopeType === "owner"
    ? { type: "owner", ownerId }
    : { type: "app", ownerId, appId: scopeAppId as string });
  return Object.freeze({
    id,
    ownerId,
    scope,
    value,
    createdAt: createdAt as number,
    ...(expiresAt !== undefined ? { expiresAt: expiresAt as number } : {}),
    createdByAppId
  });
}

/**
 * Memory entries must be explicitly curated by the owner or an authorized app.
 * This rejects common credential formats but is not a sensitive-data classifier.
 */
export function validateCuratedMemory(input: {
  consent: MemoryConsent;
  value: string;
  maxCharacters?: number;
}): string {
  const source = snapshotMemoryRecord(input, ["consent", "value", "maxCharacters"]);
  if (!source || !Object.prototype.hasOwnProperty.call(source, "consent") ||
      !Object.prototype.hasOwnProperty.call(source, "value")) {
    throw new Error("invalid_memory_value");
  }
  if (source.consent !== "curated") {
    throw new Error("memory_consent_required");
  }
  if (typeof source.value !== "string") {
    throw new Error("invalid_memory_value");
  }
  if (source.maxCharacters !== undefined &&
      (!Number.isSafeInteger(source.maxCharacters) ||
        (source.maxCharacters as number) < 1 || (source.maxCharacters as number) > 500)) {
    throw new Error("invalid_memory_value");
  }

  const value = source.value.trim();
  const maxCharacters = source.maxCharacters === undefined ? 500 : source.maxCharacters as number;

  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 ||
      maxCharacters > 500 || !value || value.length > maxCharacters) {
    throw new Error("invalid_memory_value");
  }

  const secretPatterns = [
    /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret)\s*[:=]\s*\S+/i,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  ];

  if (secretPatterns.some((pattern) => pattern.test(value))) {
    throw new Error("memory_secret_rejected");
  }

  return value;
}
