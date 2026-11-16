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
  return messages.map(({ role, content }) => ({ role, content }));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidScope(scope: unknown): scope is MemoryScope {
  if (!scope || typeof scope !== "object") return false;
  const candidate = scope as Record<string, unknown>;
  if (!isNonEmptyString(candidate.ownerId)) return false;
  if (candidate.type === "owner") return true;
  return candidate.type === "app" && isNonEmptyString(candidate.appId);
}

export function canAccessMemory(
  request: MemoryAccessRequest,
  grants: MemoryGrant[],
  now = Date.now()
): boolean {
  if (!request || !isNonEmptyString(request.ownerId) ||
      !isNonEmptyString(request.requesterAppId) ||
      (request.permission !== "read" && request.permission !== "write") ||
      !isValidScope(request.target) ||
      request.target.ownerId !== request.ownerId ||
      !Array.isArray(grants) || !Number.isFinite(now)) {
    return false;
  }

  if (request.target.type === "app" && request.target.appId === request.requesterAppId) {
    return true;
  }

  return grants.some((grant) => {
    if (!grant || typeof grant !== "object" ||
        !isNonEmptyString(grant.ownerId) ||
        !isNonEmptyString(grant.granteeAppId) ||
        (grant.scope !== "owner" && grant.scope !== "app") ||
        !Array.isArray(grant.permissions) ||
        !grant.permissions.every((permission) => permission === "read" || permission === "write") ||
        (grant.expiresAt !== undefined && !Number.isFinite(grant.expiresAt)) ||
        (grant.scope === "app" && !isNonEmptyString(grant.sourceAppId))) {
      return false;
    }

    if (
      grant.ownerId !== request.ownerId ||
      grant.granteeAppId !== request.requesterAppId ||
      !grant.permissions.includes(request.permission) ||
      (grant.expiresAt !== undefined && grant.expiresAt <= now)
    ) {
      return false;
    }

    if (request.target.type === "owner") {
      return grant.scope === "owner";
    }

    return grant.scope === "app" && grant.sourceAppId === request.target.appId;
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
  if (!input || input.consent !== "curated") {
    throw new Error("memory_consent_required");
  }
  if (typeof input.value !== "string") {
    throw new Error("invalid_memory_value");
  }

  const value = input.value.trim();
  const maxCharacters = input.maxCharacters ?? 500;

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
