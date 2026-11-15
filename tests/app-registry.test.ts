import { describe, expect, it } from "vitest";
import { parseStoredAppCapabilities, validateAppProfile } from "../src/core/apps/registry";

describe("app identity profiles", () => {
  it("accepts a curated app profile and applies safe defaults", () => {
    expect(validateAppProfile({
      description: "Assistente de produtividade",
      app_type: "assistant",
      capabilities: ["assistant", "notes"],
      contract_version: "1.0.0",
    })).toEqual({
      valid: true,
      profile: {
        description: "Assistente de produtividade",
        app_type: "assistant",
        capabilities: ["assistant", "notes"],
        contract_version: "1.0.0",
      },
    });
    expect(validateAppProfile({})).toEqual({
      valid: true,
      profile: { description: "", app_type: "other", capabilities: [], contract_version: "1.0.0" },
    });
  });

  it("rejects unknown, duplicate, oversized or malformed capability metadata", () => {
    expect(validateAppProfile({ capabilities: ["shell_execute"] })).toMatchObject({ valid: false, error: "invalid_app_capabilities" });
    expect(validateAppProfile({ capabilities: ["notes", "notes"] })).toMatchObject({ valid: false, error: "invalid_app_capabilities" });
    expect(validateAppProfile({ description: "x".repeat(281) })).toMatchObject({ valid: false, error: "invalid_app_description" });
    expect(validateAppProfile({ app_type: "root" })).toMatchObject({ valid: false, error: "invalid_app_type" });
    expect(validateAppProfile({ contract_version: "latest" })).toMatchObject({ valid: false, error: "invalid_app_contract_version" });
  });

  it("safely parses stored capability lists", () => {
    expect(parseStoredAppCapabilities('["notes","unknown","media"]')).toEqual(["notes", "media"]);
    expect(parseStoredAppCapabilities("not-json")).toEqual([]);
  });
});
