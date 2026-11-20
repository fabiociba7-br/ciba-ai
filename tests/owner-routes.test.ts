import { describe, expect, it } from "vitest";
import { resolveOwnerRoute } from "../src/http/owner-routes";

describe("owner HTTP route resolver", () => {
  it.each([
    ["/v1/owner/composio/policy", "GET", "composio-policy"],
    ["/v1/owner/composio/policy", "POST", "composio-policy"],
    ["/v1/owner/composio/invoke", "POST", "composio-invoke"],
    ["/v1/owner/facebook", "GET", "facebook-status"],
    ["/v1/owner/facebook/link", "POST", "facebook-link"],
    ["/v1/owner/facebook/pages", "GET", "facebook-data"],
    ["/v1/owner/memory", "DELETE", "memory"],
    ["/v1/owner/memory/reviews", "PATCH", "memory-reviews"],
    ["/v1/owner/agent-jobs", "POST", "agent-jobs-create"],
  ] as const)("resolves %s %s", (path, method, route) => {
    expect(resolveOwnerRoute(path, method)?.route).toBe(route);
  });

  it("extracts constrained approval and job identifiers", () => {
    const id = "job_1234567890abcd";
    expect(resolveOwnerRoute(`/v1/owner/tool-approvals/${id}/decision`, "POST"))
      .toEqual({ route: "tool-approval-decision", id });
    expect(resolveOwnerRoute(`/v1/owner/tool-approvals/${id}/execute`, "POST"))
      .toEqual({ route: "tool-approval-execute", id });
    expect(resolveOwnerRoute(`/v1/owner/agent-jobs/${id}/cancel`, "POST"))
      .toEqual({ route: "agent-job-cancel", id });
    expect(resolveOwnerRoute(`/v1/owner/agent-jobs/${id}`, "GET"))
      .toEqual({ route: "agent-job-status", id });
  });

  it("rejects unsupported methods and malformed identifiers", () => {
    expect(resolveOwnerRoute("/v1/owner/composio/invoke", "GET")).toBeNull();
    expect(resolveOwnerRoute("/v1/owner/agent-jobs/short", "GET")).toBeNull();
    expect(resolveOwnerRoute("/v1/owner/tool-approvals/short/decision", "POST")).toBeNull();
    expect(resolveOwnerRoute("/v1/owner/unknown", "GET")).toBeNull();
  });
});
