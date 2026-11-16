import type { CibaToolRisk } from "./contracts";

export interface CibaToolConsentRequest {
  conversationId: string;
  invocationId: string;
  toolId: string;
  risk: CibaToolRisk;
  input: unknown;
}

export type CibaToolConsentStatus = "approval_required" | "approved";

export type CibaToolConsentCheck =
  Omit<CibaToolConsentRequest, "conversationId" | "invocationId"> &
  Partial<Pick<CibaToolConsentRequest, "conversationId" | "invocationId">>;

const MAX_INPUT_BYTES = 64_000;
const MAX_DEPTH = 12;
const MAX_NODES = 20_000;
const MAX_STRING_CHARS = 256_000;
const CONSENT_TTL_MS = 5 * 60 * 1000;

interface SafeRequest extends Omit<CibaToolConsentRequest, "input"> {
  input: unknown;
  fingerprint: string;
  expiresAt: number;
}

interface Budget {
  nodes: number;
  stringChars: number;
}

function cloneJson(value: unknown, depth = 0, budget: Budget = {
  nodes: 0,
  stringChars: 0
}): unknown {
  if (depth > MAX_DEPTH) throw new Error("invalid_tool_consent_input");
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) throw new Error("invalid_tool_consent_input");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.stringChars += value.length;
    if (budget.stringChars > MAX_STRING_CHARS) throw new Error("invalid_tool_consent_input");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_tool_consent_input");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_tool_consent_input");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
      throw new Error("invalid_tool_consent_input");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_tool_consent_input");
      }
      result.push(cloneJson(descriptor.value, depth + 1, budget));
    }
    return Object.freeze(result);
  }
  if (typeof value !== "object") throw new Error("invalid_tool_consent_input");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("invalid_tool_consent_input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype") {
      throw new Error("invalid_tool_consent_input");
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_consent_input");
    }
    budget.stringChars += key.length;
    if (budget.stringChars > MAX_STRING_CHARS) throw new Error("invalid_tool_consent_input");
    result[key] = cloneJson(descriptor.value, depth + 1, budget);
  }
  return Object.freeze(result);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("invalid_tool_consent_input");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

function snapshotRequest(input: unknown): SafeRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error("invalid_tool_consent_request");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["conversationId", "invocationId", "toolId", "risk", "input"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowed.size ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new Error("invalid_tool_consent_request");
  }
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_consent_request");
    }
    fields[key] = descriptor.value;
  }
  for (const key of ["conversationId", "invocationId", "toolId"] as const) {
    if (typeof fields[key] !== "string" || !fields[key].trim() ||
        (fields[key] as string).length > 128) {
      throw new Error("invalid_tool_consent_request");
    }
  }
  if (!["read", "write", "external"].includes(fields.risk as string)) {
    throw new Error("invalid_tool_consent_request");
  }
  const safeInput = cloneJson(fields.input);
  const serialized = JSON.stringify(safeInput);
  if (serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_INPUT_BYTES) {
    throw new Error("invalid_tool_consent_request");
  }
  return {
    conversationId: fields.conversationId as string,
    invocationId: fields.invocationId as string,
    toolId: fields.toolId as string,
    risk: fields.risk as CibaToolRisk,
    input: safeInput,
    fingerprint: canonicalJson(safeInput),
    expiresAt: Date.now() + CONSENT_TTL_MS
  };
}

/**
 * One-use, in-memory consent. Approval is bound to a conversation, invocation,
 * tool, risk class and canonical input; no persistent or thread-wide grants exist.
 */
export interface CibaToolConsentStore {
  request(request: CibaToolConsentRequest): CibaToolConsentStatus;
  answer(invocationId: string, conversationId: string, toolId: string, input: unknown, allow: boolean): boolean;
  consume(request: CibaToolConsentCheck): boolean;
  cancel(invocationId: string, conversationId: string): boolean;
}

export function createCibaToolConsentStore(): CibaToolConsentStore {
  const pending = new Map<string, SafeRequest>();
  const approved = new Map<string, SafeRequest>();
  const closed = new Map<string, number>();

  function matches(first: SafeRequest, next: SafeRequest): boolean {
    return first.conversationId === next.conversationId &&
      first.invocationId === next.invocationId &&
      first.toolId === next.toolId &&
      first.risk === next.risk &&
      first.fingerprint === next.fingerprint;
  }

  function prune(now: number): void {
    for (const [id, item] of pending) {
      if (item.expiresAt <= now) {
        pending.delete(id);
        closed.set(id, now + CONSENT_TTL_MS);
      }
    }
    for (const [id, item] of approved) {
      if (item.expiresAt <= now) {
        approved.delete(id);
        closed.set(id, now + CONSENT_TTL_MS);
      }
    }
    for (const [id, expiresAt] of closed) if (expiresAt <= now) closed.delete(id);
  }

  return Object.freeze({
    request(rawRequest: CibaToolConsentRequest): CibaToolConsentStatus {
      const request = snapshotRequest(rawRequest);
      prune(Date.now());
      if (closed.has(request.invocationId)) throw new Error("tool_consent_invocation_closed");
      const existing = pending.get(request.invocationId) ?? approved.get(request.invocationId);
      if (existing) {
        if (!matches(existing, request)) throw new Error("tool_consent_invocation_conflict");
        return approved.has(request.invocationId) ? "approved" : "approval_required";
      }
      pending.set(request.invocationId, request);
      return "approval_required";
    },

    answer(invocationId: string, conversationId: string, toolId: string, input: unknown, allow: boolean): boolean {
      if (typeof invocationId !== "string" || typeof conversationId !== "string" ||
          typeof toolId !== "string" || typeof allow !== "boolean") return false;
      prune(Date.now());
      const existing = pending.get(invocationId);
      if (!existing || existing.conversationId !== conversationId || existing.toolId !== toolId) return false;
      let candidate: SafeRequest;
      try {
        candidate = snapshotRequest({
          conversationId,
          invocationId,
          toolId,
          risk: existing.risk,
          input
        });
      } catch {
        return false;
      }
      if (!matches(existing, candidate)) return false;
      pending.delete(invocationId);
      if (!allow) {
        closed.set(invocationId, Date.now() + CONSENT_TTL_MS);
        return false;
      }
      approved.set(invocationId, existing);
      return true;
    },

    consume(rawRequest: CibaToolConsentCheck): boolean {
      let request: SafeRequest;
      try {
        request = snapshotRequest(rawRequest as CibaToolConsentRequest);
      } catch {
        return false;
      }
      prune(Date.now());
      const existing = approved.get(request.invocationId);
      if (!existing || !matches(existing, request)) return false;
      approved.delete(request.invocationId);
      closed.set(request.invocationId, Date.now() + CONSENT_TTL_MS);
      return true;
    },

    cancel(invocationId: string, conversationId: string): boolean {
      if (typeof invocationId !== "string" || typeof conversationId !== "string") return false;
      const item = pending.get(invocationId) ?? approved.get(invocationId);
      if (!item || item.conversationId !== conversationId) return false;
      pending.delete(invocationId);
      approved.delete(invocationId);
      closed.set(invocationId, Date.now() + CONSENT_TTL_MS);
      return true;
    }
  });
}
