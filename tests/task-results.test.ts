import { describe, expect, it } from "vitest";
import { consolidateTaskResults, type TaskResultRecord } from "../src/core/task-results";

const result = (
  appId: string,
  status: "completed" | "partial" | "failed",
  value?: unknown,
): TaskResultRecord => ({
  source_app_id: appId,
  task_id: "task-1",
  payload: { protocol: "garcia.task.result", status, ...(value === undefined ? {} : { result: value }) },
});

describe("Garcia task result consolidation", () => {
  it("waits when no app has returned a result", () => {
    expect(consolidateTaskResults("task-1", [])).toMatchObject({
      status: "awaiting_results", total_results: 0, agreement: null,
    });
  });

  it("returns a single result without pretending there is consensus", () => {
    expect(consolidateTaskResults("task-1", [
      result("app-a", "completed", { summary: "done" }),
    ])).toMatchObject({
      status: "single_result", completed_results: 1, agreement: true,
      consensus_result: { summary: "done" },
    });
  });

  it("detects exact structural agreement independent of object key order", () => {
    expect(consolidateTaskResults("task-1", [
      result("app-a", "completed", { title: "A", count: 2 }),
      result("app-b", "partial", { count: 2, title: "A" }),
    ])).toMatchObject({
      status: "agreement", completed_results: 1, partial_results: 1,
      distinct_successful_outputs: 1, agreement: true,
      consensus_result: { title: "A", count: 2 },
    });
  });

  it("flags conflicting outputs and never selects one as consensus", () => {
    expect(consolidateTaskResults("task-1", [
      result("app-a", "completed", { answer: "A" }),
      result("app-b", "completed", { answer: "B" }),
    ])).toMatchObject({
      status: "divergent", distinct_successful_outputs: 2,
      agreement: false, consensus_result: null,
      divergent_source_app_ids: ["app-a", "app-b"],
    });
  });

  it("does not count failed or unrelated task results as successful evidence", () => {
    const unrelated = { ...result("app-x", "completed", { answer: 1 }), task_id: "other" };
    expect(consolidateTaskResults("task-1", [
      result("app-a", "failed"), unrelated,
    ])).toMatchObject({
      status: "no_successful_results", total_results: 1,
      failed_results: 1, agreement: null,
    });
  });
});
