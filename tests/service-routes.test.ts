import { describe, expect, it } from "vitest";
import { resolveServiceRoute } from "../src/http/service-routes";

describe("service HTTP route resolver", () => {
  it.each([
    ["/v1/config", "GET", "config"],
    ["/v1/status", "GET", "status"],
    ["/v1/models", "GET", "models"],
    ["/v1/ai/capabilities", "GET", "ai-capabilities"],
    ["/v1/mcp", "GET", "mcp"],
    ["/v1/mcp", "POST", "mcp"],
    ["/v1/ai/chat", "POST", "ai-chat"],
    ["/v1/usage", "GET", "usage"],
  ] as const)("resolves %s %s", (path, method, route) => {
    expect(resolveServiceRoute(path, method)).toBe(route);
  });

  it("rejects unsupported methods and unknown paths", () => {
    expect(resolveServiceRoute("/v1/config", "POST")).toBeNull();
    expect(resolveServiceRoute("/v1/status", "POST")).toBeNull();
    expect(resolveServiceRoute("/v1/ai/chat", "GET")).toBeNull();
    expect(resolveServiceRoute("/v1/usage", "POST")).toBeNull();
    expect(resolveServiceRoute("/v1/unknown", "GET")).toBeNull();
  });
});
