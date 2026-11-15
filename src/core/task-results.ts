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

/** Stable JSON representation used only for exact structural comparison.
 * It does not infer meaning, rank quality, or merge conflicting content. */
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
  const valid = results.filter((item) =>
    item.task_id === taskId &&
    item.payload?.protocol === "garcia.task.result" &&
    ["completed", "partial", "failed"].includes(item.payload.status) &&
    typeof item.source_app_id === "string" &&
    item.source_app_id.length > 0
  );
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

  const agreement = successful.length === 0
    ? null
    : distinct === 1;
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
