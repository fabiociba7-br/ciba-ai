import { describe, expect, it } from "vitest";
import { resolveAppRoute } from "../src/http/app-routes";

describe("app HTTP route resolver", () => {
  it.each([
    ["/v1/apps/tasks/dispatch", "POST", "task-dispatch"],
    ["/v1/apps/tasks/status", "GET", "task-status"],
    ["/v1/apps/tasks/results", "GET", "task-results"],
    ["/v1/apps/tasks/results", "POST", "task-results-submit"],
    ["/v1/apps/tasks/synthesize", "POST", "task-synthesize"],
    ["/v1/apps/context/share", "POST", "context-share"],
    ["/v1/apps/messages", "POST", "messages-send"],
    ["/v1/apps/messages/inbox", "GET", "messages-inbox"],
    ["/v1/apps/messages/ack", "POST", "messages-ack"],
  ] as const)("resolves %s %s", (path, method, route) => {
    expect(resolveAppRoute(path, method)).toBe(route);
  });

  it("rejects unsupported methods and unknown paths", () => {
    expect(resolveAppRoute("/v1/apps/tasks/dispatch", "GET")).toBeNull();
    expect(resolveAppRoute("/v1/apps/messages/inbox", "POST")).toBeNull();
    expect(resolveAppRoute("/v1/apps/unknown", "GET")).toBeNull();
  });
});
