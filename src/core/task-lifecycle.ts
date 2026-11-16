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

/** Derives task progress from the existing request acknowledgement and result queue.
 * Acknowledgement means received, not that execution succeeded. */
export function deriveTaskLifecycle(input: TaskLifecycleInput): {
  status: TaskLifecycleStatus;
  acknowledged: boolean;
  result_count: number;
  completed_results: number;
  partial_results: number;
  failed_results: number;
  expires_at: string;
} {
  const statuses = input.resultStatuses;
  const completed = statuses.filter((status) => status === "completed").length;
  const partial = statuses.filter((status) => status === "partial").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const expired = new Date(input.expiresAt).getTime() <= new Date(input.now ?? new Date().toISOString()).getTime();

  const status: TaskLifecycleStatus = statuses.length > 0
    ? completed === statuses.length ? "completed"
      : failed === statuses.length ? "failed"
        : "partial"
    : expired ? "expired"
      : input.acknowledgedAt ? "processing" : "awaiting_delivery";

  return {
    status,
    acknowledged: input.acknowledgedAt !== null,
    result_count: statuses.length,
    completed_results: completed,
    partial_results: partial,
    failed_results: failed,
    expires_at: input.expiresAt,
  };
}
