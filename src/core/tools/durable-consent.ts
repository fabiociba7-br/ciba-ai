import type { CibaToolRisk } from "./contracts";

export interface DurableToolApprovalIdentity {
  ownerId: string;
  appId: string;
  deviceId: string;
}

export interface DurableToolApprovalRequest {
  conversationId: string;
  invocationId: string;
  toolId: string;
  risk: Exclude<CibaToolRisk, "read">;
  input: unknown;
}

export type DurableToolApprovalStatus =
  | "pending" | "approved" | "denied" | "consumed" | "cancelled" | "expired";

export interface DurableToolApprovalResult {
  approvalId: string;
  status: "approval_required" | "approved";
}

export interface DurableToolApprovalStore {
  request(identity: DurableToolApprovalIdentity, request: DurableToolApprovalRequest): Promise<DurableToolApprovalResult>;
  answer(args: {
    approvalId: string;
    identity: DurableToolApprovalIdentity;
    request: DurableToolApprovalRequest;
    approverDeviceId: string;
    allow: boolean;
  }): Promise<boolean>;
  consume(args: {
    approvalId: string;
    identity: DurableToolApprovalIdentity;
    request: DurableToolApprovalRequest;
  }): Promise<boolean>;
  cancel(approvalId: string, identity: DurableToolApprovalIdentity): Promise<boolean>;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1Statement;
}

interface StoreOptions {
  ttlMs?: number;
  now?: () => number;
  createId?: () => string;
}

const MAX_INPUT_BYTES = 64_000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function validText(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function snapshotJson(value: unknown, depth = 0, budget = { nodes: 0, chars: 0 }): unknown {
  if (depth > 12 || ++budget.nodes > 20_000) throw new Error("invalid_tool_approval_input");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.chars += value.length;
    if (budget.chars > 256_000) throw new Error("invalid_tool_approval_input");
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_tool_approval_input");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new Error("invalid_tool_approval_input");
    return Object.freeze(value.map((_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_tool_approval_input");
      }
      return snapshotJson(descriptor.value, depth + 1, budget);
    }));
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_tool_approval_input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("invalid_tool_approval_input");
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_approval_input");
    }
    budget.chars += key.length;
    if (budget.chars > 256_000) throw new Error("invalid_tool_approval_input");
    result[key] = snapshotJson(descriptor.value, depth + 1, budget);
  }
  return Object.freeze(result);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("invalid_tool_approval_input");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateIdentity(identity: DurableToolApprovalIdentity): void {
  if (!identity || !validText(identity.ownerId) || !validText(identity.appId, 150) ||
      !validText(identity.deviceId)) throw new Error("invalid_tool_approval_identity");
}

function validateRequest(request: DurableToolApprovalRequest): { inputJson: string; inputSha256: string } {
  if (!request || !validText(request.conversationId) || !validText(request.invocationId) ||
      !validText(request.toolId) || (request.risk !== "write" && request.risk !== "external")) {
    throw new Error("invalid_tool_approval_request");
  }
  const inputJson = canonicalJson(snapshotJson(request.input));
  if (new TextEncoder().encode(inputJson).byteLength > MAX_INPUT_BYTES) {
    throw new Error("invalid_tool_approval_input");
  }
  return { inputJson, inputSha256: "" };
}

/**
 * D1-backed approval storage. Identity must come from an authenticated server
 * context; never construct it from caller-supplied owner/app/device identifiers.
 * This module is deliberately not wired into the Worker or tool executor.
 */
export function createD1ToolApprovalStore(
  db: D1DatabaseLike,
  options: StoreOptions = {}
): DurableToolApprovalStore {
  if (!db || typeof db.prepare !== "function") throw new Error("tool_approval_database_required");
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60 * 1000) {
    throw new Error("invalid_tool_approval_ttl");
  }

  return Object.freeze({
    async request(identity, request) {
      validateIdentity(identity);
      const { inputJson } = validateRequest(request);
      const inputSha256 = await digest(inputJson);
      const timestamp = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const approvalId = createId();

      await db.prepare(`
        INSERT OR IGNORE INTO tool_approvals(
          approval_id, owner_id, app_id, device_id, conversation_id,
          invocation_id, tool_id, risk, input_json, input_sha256,
          status, created_at, expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM devices d JOIN owners o ON o.owner_id = d.owner_id
          WHERE d.device_id = ? AND d.owner_id = ? AND d.app_id = ?
            AND d.revoked_at IS NULL AND o.status = 'active' AND o.revoked_at IS NULL
        )
      `).bind(
        approvalId, identity.ownerId, identity.appId, identity.deviceId,
        request.conversationId, request.invocationId, request.toolId, request.risk,
        inputJson, inputSha256, timestamp, expiresAt,
        identity.deviceId, identity.ownerId, identity.appId
      ).run();

      const existing = await db.prepare(`
        SELECT approval_id, conversation_id, invocation_id, tool_id, risk,
          input_json, input_sha256, status, expires_at
        FROM tool_approvals
        WHERE owner_id = ? AND app_id = ? AND device_id = ? AND invocation_id = ?
          AND EXISTS (
            SELECT 1 FROM devices d JOIN owners o ON o.owner_id = d.owner_id
            WHERE d.device_id = ? AND d.owner_id = ? AND d.app_id = ?
              AND d.revoked_at IS NULL AND o.status = 'active' AND o.revoked_at IS NULL
          )
        LIMIT 1
      `).bind(
        identity.ownerId, identity.appId, identity.deviceId, request.invocationId,
        identity.deviceId, identity.ownerId, identity.appId
      )
        .first<{
          approval_id: string; conversation_id: string; invocation_id: string;
          tool_id: string; risk: string; input_json: string; input_sha256: string;
          status: DurableToolApprovalStatus; expires_at: string;
        }>();

      if (!existing) throw new Error("tool_approval_persistence_failed");
      if (existing.conversation_id !== request.conversationId ||
          existing.invocation_id !== request.invocationId || existing.tool_id !== request.toolId ||
          existing.risk !== request.risk || existing.input_json !== inputJson ||
          existing.input_sha256 !== inputSha256) {
        throw new Error("tool_approval_invocation_conflict");
      }
      if (existing.status === "pending" || existing.status === "approved") {
        if (existing.expires_at <= timestamp) {
          await db.prepare(`
            UPDATE tool_approvals SET status = 'expired', closed_at = ?
            WHERE approval_id = ? AND status IN ('pending', 'approved') AND expires_at <= ?
          `).bind(timestamp, existing.approval_id, timestamp).run();
          throw new Error("tool_approval_expired");
        }
        return {
          approvalId: existing.approval_id,
          status: existing.status === "approved" ? "approved" : "approval_required"
        };
      }
      throw new Error("tool_approval_invocation_closed");
    },

    async answer({ approvalId, identity, request, approverDeviceId, allow }) {
      validateIdentity(identity);
      if (!validText(approvalId) || !validText(approverDeviceId) || typeof allow !== "boolean") return false;
      const { inputJson } = validateRequest(request);
      const inputSha256 = await digest(inputJson);
      const timestamp = new Date(now()).toISOString();
      const status = allow ? "approved" : "denied";
      const result = await db.prepare(`
        UPDATE tool_approvals
        SET status = ?, decided_at = ?, approved_by_device_id = ?,
            closed_at = CASE WHEN ? = 'denied' THEN ? ELSE NULL END
        WHERE approval_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?
          AND conversation_id = ? AND invocation_id = ? AND tool_id = ? AND risk = ?
          AND input_json = ? AND input_sha256 = ? AND status = 'pending' AND expires_at > ?
          AND EXISTS (
            SELECT 1 FROM devices source
            JOIN owners owner ON owner.owner_id = source.owner_id
            WHERE source.device_id = ? AND source.owner_id = ? AND source.app_id = ?
              AND source.revoked_at IS NULL AND owner.status = 'active' AND owner.revoked_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM devices approver
            JOIN owners owner ON owner.owner_id = approver.owner_id
            WHERE approver.device_id = ? AND approver.owner_id = ? AND approver.app_id = ?
              AND approver.revoked_at IS NULL AND owner.status = 'active' AND owner.revoked_at IS NULL
          )
      `).bind(
        status, timestamp, approverDeviceId, status, timestamp,
        approvalId, identity.ownerId, identity.appId, identity.deviceId,
        request.conversationId, request.invocationId, request.toolId, request.risk,
        inputJson, inputSha256, timestamp,
        identity.deviceId, identity.ownerId, identity.appId,
        approverDeviceId, identity.ownerId, identity.appId
      ).run();
      if ((result.meta?.changes ?? 0) === 1) return true;

      await db.prepare(`
        UPDATE tool_approvals SET status = 'expired', closed_at = ?
        WHERE approval_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?
          AND status = 'pending' AND expires_at <= ?
      `).bind(timestamp, approvalId, identity.ownerId, identity.appId, identity.deviceId, timestamp).run();
      return false;
    },

    async consume({ approvalId, identity, request }) {
      validateIdentity(identity);
      if (!validText(approvalId)) return false;
      const { inputJson } = validateRequest(request);
      const inputSha256 = await digest(inputJson);
      const timestamp = new Date(now()).toISOString();
      const result = await db.prepare(`
        UPDATE tool_approvals
        SET status = 'consumed', consumed_at = ?, closed_at = ?
        WHERE approval_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?
          AND conversation_id = ? AND invocation_id = ? AND tool_id = ? AND risk = ?
          AND input_json = ? AND input_sha256 = ? AND status = 'approved' AND expires_at > ?
          AND EXISTS (
            SELECT 1 FROM devices d JOIN owners o ON o.owner_id = d.owner_id
            WHERE d.device_id = ? AND d.owner_id = ? AND d.app_id = ?
              AND d.revoked_at IS NULL AND o.status = 'active' AND o.revoked_at IS NULL
          )
      `).bind(
        timestamp, timestamp, approvalId, identity.ownerId, identity.appId, identity.deviceId,
        request.conversationId, request.invocationId, request.toolId, request.risk,
        inputJson, inputSha256, timestamp,
        identity.deviceId, identity.ownerId, identity.appId
      ).run();
      if ((result.meta?.changes ?? 0) === 1) return true;

      await db.prepare(`
        UPDATE tool_approvals SET status = 'expired', closed_at = ?
        WHERE approval_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?
          AND status = 'approved' AND expires_at <= ?
      `).bind(timestamp, approvalId, identity.ownerId, identity.appId, identity.deviceId, timestamp).run();
      return false;
    },

    async cancel(approvalId, identity) {
      validateIdentity(identity);
      if (!validText(approvalId)) return false;
      const timestamp = new Date(now()).toISOString();
      const result = await db.prepare(`
        UPDATE tool_approvals SET status = 'cancelled', closed_at = ?
        WHERE approval_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?
          AND status IN ('pending', 'approved') AND expires_at > ?
          AND EXISTS (
            SELECT 1 FROM devices d JOIN owners o ON o.owner_id = d.owner_id
            WHERE d.device_id = ? AND d.owner_id = ? AND d.app_id = ?
              AND d.revoked_at IS NULL AND o.status = 'active' AND o.revoked_at IS NULL
          )
      `).bind(
        timestamp, approvalId, identity.ownerId, identity.appId, identity.deviceId, timestamp,
        identity.deviceId, identity.ownerId, identity.appId
      ).run();
      return (result.meta?.changes ?? 0) === 1;
    }
  });
}
