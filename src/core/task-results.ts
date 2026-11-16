export type TaskResultStatus = "completed" | "partial" | "failed";

export interface TaskResultRecord {
  source_app_id: string;
  task_id: string;
  payload: {
    protocol: "garcia.task.result";
    status: TaskResultStatus;
    result?: unknown;
  };
}

export type TaskConsolidationStatus =
  | "awaiting_results"
  | "no_successful_results"
  | "single_result"
  | "agreement"
  | "divergent";

export interface TaskConsolidation {
  status: TaskConsolidationStatus;
  task_id: string;
  total_results: number;
  completed_results: number;
  partial_results: number;
  failed_results: number;
  distinct_successful_outputs: number;
  agreement: boolean | null;
  consensus_result: unknown | null;
  sources: Array<{ app_id: string; status: TaskResultStatus }>;
  divergent_source_app_ids: string[];
}

const MAX_RESULTS = 200;
const MAX_TASK_ID_CHARS = 100;
const MAX_APP_ID_CHARS = 128;
const MAX_RESULT_BYTES = 64_000;
const MAX_RESULT_DEPTH = 12;
const MAX_RESULT_NODES = 10_000;
const MAX_RESULT_STRING_CHARS = 64_000;

interface JsonBudget {
  nodes: number;
  stringChars: number;
}

/** Copies only JSON data properties; never invokes accessors or custom serializers. */
function snapshotJson(value: unknown, depth = 0, budget: JsonBudget = {
  nodes: 0,
  stringChars: 0
}): unknown {
  if (depth > MAX_RESULT_DEPTH) throw new Error("task_result_too_deep");
  budget.nodes += 1;
  if (budget.nodes > MAX_RESULT_NODES) throw new Error("task_result_too_complex");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.stringChars += value.length;
    if (budget.stringChars > MAX_RESULT_STRING_CHARS) throw new Error("task_result_too_large");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_task_result");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_RESULT_NODES) {
      throw new Error("invalid_task_result");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
      throw new Error("invalid_task_result");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_task_result");
      }
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return Object.freeze(result);
  }
  if (typeof value !== "object") throw new Error("invalid_task_result");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_task_result");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype") {
      throw new Error("invalid_task_result");
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_task_result");
    }
    budget.stringChars += key.length;
    if (budget.stringChars > MAX_RESULT_STRING_CHARS) throw new Error("task_result_too_large");
    result[key] = snapshotJson(descriptor.value, depth + 1, budget);
  }
  return Object.freeze(result);
}

function snapshotRecord(value: unknown, taskId: string): TaskResultRecord | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = new Set(["source_app_id", "task_id", "payload"]);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) return null;
    const fields: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      fields[key] = descriptor.value;
    }
    if (typeof fields.source_app_id !== "string" || !fields.source_app_id.trim() ||
        fields.source_app_id.length > MAX_APP_ID_CHARS ||
        fields.task_id !== taskId ||
        fields.payload === null || typeof fields.payload !== "object" ||
        Array.isArray(fields.payload) ||
        Object.getPrototypeOf(fields.payload) !== Object.prototype) return null;

    const payloadDescriptors = Object.getOwnPropertyDescriptors(fields.payload);
    const payloadAllowed = new Set(["protocol", "status", "result"]);
    const payloadKeys = Reflect.ownKeys(payloadDescriptors);
    if (payloadKeys.some((key) => typeof key !== "string" || !payloadAllowed.has(key))) return null;
    const payload: Record<string, unknown> = Object.create(null);
    for (const key of payloadKeys as string[]) {
      const descriptor = payloadDescriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      payload[key] = descriptor.value;
    }
    if (payload.protocol !== "garcia.task.result" ||
        !["completed", "partial", "failed"].includes(payload.status as string)) return null;

    const safeResult = payload.result === undefined
      ? undefined
      : snapshotJson(payload.result);
    if (safeResult !== undefined) {
      const serialized = JSON.stringify(safeResult);
      if (serialized === undefined ||
          new TextEncoder().encode(serialized).byteLength > MAX_RESULT_BYTES) return null;
    }
    return Object.freeze({
      source_app_id: fields.source_app_id,
      task_id: taskId,
      payload: Object.freeze({
        protocol: "garcia.task.result",
        status: payload.status as TaskResultStatus,
        ...(safeResult === undefined ? {} : { result: safeResult })
      })
    });
  } catch {
    return null;
  }
}

/** Stable JSON representation used only for exact structural comparison of safe snapshots. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    return primitive === undefined ? "undefined" : primitive;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

export function consolidateTaskResults(
  taskId: string,
  results: TaskResultRecord[]
): TaskConsolidation {
  if (typeof taskId !== "string" || !taskId.trim() || taskId.length > MAX_TASK_ID_CHARS) {
    throw new Error("invalid_task_id");
  }

  let snapshots: TaskResultRecord[] = [];
  try {
    if (!Array.isArray(results) || Object.getPrototypeOf(results) !== Array.prototype ||
        results.length > MAX_RESULTS) throw new Error("invalid_task_results");
    const descriptors = Object.getOwnPropertyDescriptors(results);
    if (Reflect.ownKeys(descriptors).length !== results.length + 1) {
      throw new Error("invalid_task_results");
    }
    snapshots = [];
    for (let index = 0; index < results.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_task_results");
      }
      const snapshot = snapshotRecord(descriptor.value, taskId);
      if (snapshot) snapshots.push(snapshot);
    }
  } catch {
    snapshots = [];
  }

  const valid = snapshots;
  const completed = valid.filter((item) => item.payload.status === "completed");
  const partial = valid.filter((item) => item.payload.status === "partial");
  const failed = valid.filter((item) => item.payload.status === "failed");
  const successful = [...completed, ...partial].filter((item) =>
    item.payload.result !== undefined
  );

  const outputGroups = new Map<string, { result: unknown; appIds: string[] }>();
  for (const item of successful) {
    const key = canonicalJson(item.payload.result);
    const group = outputGroups.get(key) ?? { result: item.payload.result, appIds: [] };
    group.appIds.push(item.source_app_id);
    outputGroups.set(key, group);
  }

  const distinct = outputGroups.size;
  const status: TaskConsolidationStatus = valid.length === 0
    ? "awaiting_results"
    : successful.length === 0
      ? "no_successful_results"
      : successful.length === 1
        ? "single_result"
        : distinct === 1
          ? "agreement"
          : "divergent";

  const agreement = successful.length === 0 ? null : distinct === 1;
  const divergentSourceIds = distinct > 1
    ? successful.map((item) => item.source_app_id)
    : [];

  return {
    status,
    task_id: taskId,
    total_results: valid.length,
    completed_results: completed.length,
    partial_results: partial.length,
    failed_results: failed.length,
    distinct_successful_outputs: distinct,
    agreement,
    consensus_result: agreement === true ? outputGroups.values().next().value?.result ?? null : null,
    sources: valid.map((item) => ({ app_id: item.source_app_id, status: item.payload.status })),
    divergent_source_app_ids: [...new Set(divergentSourceIds)],
  };
}
