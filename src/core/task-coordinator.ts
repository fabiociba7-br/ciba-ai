import { APP_TASK_TYPES, type AppTaskType } from "./apps/registry";

export interface TaskRouteCandidate {
  appId: string;
  displayName: string;
  taskTypes: string[];
  sendGranted: boolean;
  receiveGranted: boolean;
}

export type TaskRouteDecision =
  | { status: "selected"; candidate: TaskRouteCandidate }
  | { status: "ambiguous"; candidates: TaskRouteCandidate[] }
  | { status: "no_capable_app" }
  | { status: "no_granted_app"; capableAppIds: string[] };

export function isAppTaskType(value: unknown): value is AppTaskType {
  return typeof value === "string" &&
    (APP_TASK_TYPES as readonly string[]).includes(value);
}

/** Deterministic, fail-closed routing. Declared task types are discovery metadata;
 * a route is eligible only when both directional grants are currently valid. */
export function selectTaskRoute(
  taskType: AppTaskType,
  candidates: TaskRouteCandidate[],
  preferredAppId?: string
): TaskRouteDecision {
  const capable = candidates.filter((candidate) =>
    candidate.appId !== "" &&
    candidate.taskTypes.includes(taskType) &&
    (!preferredAppId || candidate.appId === preferredAppId)
  );
  if (capable.length === 0) return { status: "no_capable_app" };
  const eligible = capable.filter((candidate) => candidate.sendGranted && candidate.receiveGranted);
  if (eligible.length === 0) {
    return { status: "no_granted_app", capableAppIds: capable.map((candidate) => candidate.appId) };
  }
  if (eligible.length > 1) return { status: "ambiguous", candidates: eligible };
  return { status: "selected", candidate: eligible[0] };
}
