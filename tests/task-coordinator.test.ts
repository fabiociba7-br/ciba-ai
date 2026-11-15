import { describe, expect, it } from "vitest";
import { selectTaskRoute } from "../src/core/task-coordinator";

const candidate = (appId: string, sendGranted = true, receiveGranted = true) => ({
  appId, displayName: appId, taskTypes: ["summarize", "research"],
  sendGranted, receiveGranted,
});

describe("Garcia task coordinator", () => {
  it("selects the only capable app with both grants", () => {
    expect(selectTaskRoute("summarize", [
      candidate("com.ciba.notes", true, true),
      candidate("com.ciba.calendar", false, false),
    ])).toMatchObject({ status: "selected", candidate: { appId: "com.ciba.notes" } });
  });

  it("requires an explicit choice when multiple eligible apps match", () => {
    expect(selectTaskRoute("research", [
      candidate("com.ciba.a"), candidate("com.ciba.b"),
    ])).toMatchObject({ status: "ambiguous", candidates: [{ appId: "com.ciba.a" }, { appId: "com.ciba.b" }] });
  });

  it("does not route without both directional grants", () => {
    expect(selectTaskRoute("summarize", [candidate("com.ciba.notes", true, false)]))
      .toEqual({ status: "no_granted_app", capableAppIds: ["com.ciba.notes"] });
  });

  it("rejects a preferred app that does not declare the requested task", () => {
    expect(selectTaskRoute("summarize", [candidate("com.ciba.notes")], "com.ciba.other"))
      .toEqual({ status: "no_capable_app" });
  });
});
