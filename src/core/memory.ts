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

export function canAccessMemory(
  request: MemoryAccessRequest,
  grants: MemoryGrant[],
  now = Date.now()
): boolean {
  if (!request.ownerId || request.target.ownerId !== request.ownerId || !request.requesterAppId) {
    return false;
  }

  if (request.target.type === "app" && request.target.appId === request.requesterAppId) {
    return true;
  }

  return grants.some((grant) => {
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
 * This validator rejects obvious credential-like strings; it is not a
 * sensitive-data classifier and must not be treated as one.
 */
export function validateCuratedMemory(input: {
  consent: MemoryConsent;
  value: string;
  maxCharacters?: number;
}): string {
  if (input.consent !== "curated") {
    throw new Error("memory_consent_required");
  }

  const value = input.value.trim();
  const maxCharacters = input.maxCharacters ?? 500;

  if (!value || value.length > maxCharacters) {
    throw new Error("invalid_memory_value");
  }

  const looksLikeSecret =
    /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value);

  if (looksLikeSecret) {
    throw new Error("memory_secret_rejected");
  }

  return value;
}
