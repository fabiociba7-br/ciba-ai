export type TaskLifecycleStatus =
  | "awaiting_delivery"
  | "processing"
  | "completed"
  | "partial"
  | "failed"
  | "expired";

export interface TaskLifecycleInput {
  acknowledgedAt: string | null;
  expiresAt: string;
  resultStatuses: Array<"completed" | "partial" | "failed">;
  now?: string;
}

const MAX_RESULT_STATUSES = 200;
const MAX_TIMESTAMP_CHARS = 64;
const VALID_RESULT_STATUSES = new Set(["completed", "partial", "failed"]);

function readInputSnapshot(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("invalid_task_lifecycle_input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(["acknowledgedAt", "expiresAt", "resultStatuses", "now"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      !["acknowledgedAt", "expiresAt", "resultStatuses"].every((key) =>
        Object.prototype.hasOwnProperty.call(descriptors, key))) {
    throw new Error("invalid_task_lifecycle_input");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_task_lifecycle_input");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function validTimestamp(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_TIMESTAMP_CHARS && Number.isFinite(Date.parse(value));
}

/** Derives progress from an immutable snapshot; acknowledgement means received, not completed. */
export function deriveTaskLifecycle(input: TaskLifecycleInput): {
  status: TaskLifecycleStatus;
  acknowledged: boolean;
  result_count: number;
  completed_results: number;
  partial_results: number;
  failed_results: number;
  expires_at: string;
} {
  let fields: Record<string, unknown>;
  try {
    fields = readInputSnapshot(input);
  } catch {
    throw new Error("invalid_task_lifecycle_input");
  }

  const acknowledgedAt = fields.acknowledgedAt;
  const expiresAt = fields.expiresAt;
  const rawStatuses = fields.resultStatuses;
  const now = fields.now === undefined ? new Date().toISOString() : fields.now;

  if (!validTimestamp(acknowledgedAt, true) ||
      !validTimestamp(expiresAt) ||
      !validTimestamp(now) ||
      !Array.isArray(rawStatuses) ||
      Object.getPrototypeOf(rawStatuses) !== Array.prototype ||
      rawStatuses.length > MAX_RESULT_STATUSES) {
    throw new Error("invalid_task_lifecycle_input");
  }

  const descriptors = Object.getOwnPropertyDescriptors(rawStatuses);
  if (Reflect.ownKeys(descriptors).length !== rawStatuses.length + 1) {
    throw new Error("invalid_task_lifecycle_input");
  }
  const statuses: Array<"completed" | "partial" | "failed"> = [];
  for (let index = 0; index < rawStatuses.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        !VALID_RESULT_STATUSES.has(descriptor.value as string)) {
      throw new Error("invalid_task_lifecycle_input");
    }
    statuses.push(descriptor.value as "completed" | "partial" | "failed");
  }

  const completed = statuses.filter((status) => status === "completed").length;
  const partial = statuses.filter((status) => status === "partial").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const expired = Date.parse(expiresAt) <= Date.parse(now);

  const status: TaskLifecycleStatus = statuses.length > 0
    ? completed === statuses.length ? "completed"
      : failed === statuses.length ? "failed"
        : "partial"
    : expired ? "expired"
      : acknowledgedAt ? "processing" : "awaiting_delivery";

  return {
    status,
    acknowledged: acknowledgedAt !== null,
    result_count: statuses.length,
    completed_results: completed,
    partial_results: partial,
    failed_results: failed,
    expires_at: expiresAt,
  };
}
