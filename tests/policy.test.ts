import { describe, expect, it } from "vitest";
import { getLimit, isValidAppId, resolveModel, MAX_REQUESTS_PER_MINUTE, MAX_ADMIN_AUTH_FAILURES_PER_MINUTE } from "../src/policy";

describe("policy: numeric limits", () => {
  it("accepts positive safe integers", () => {
    expect(getLimit("25", 10)).toBe(25);
    expect(getLimit("1", 10)).toBe(1);
  });
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "999999999999999999999"])("uses fallback for invalid value %s", (value) => {
    expect(getLimit(value, 10)).toBe(10);
  });
  it("uses fallback when setting is absent", () => expect(getLimit(undefined, 7)).toBe(7));
});

describe("policy: inference model", () => {
  it("uses the approved default model", () => expect(resolveModel()).toBe("@cf/google/gemma-4-26b-a4b-it"));
  it("accepts the explicitly approved model", () => expect(resolveModel("@cf/google/gemma-4-26b-a4b-it")).toBe("@cf/google/gemma-4-26b-a4b-it"));
  it("rejects models not on the zero-cost allowlist", () => {
    expect(resolveModel("@cf/meta/llama-paid")).toBeNull();
    expect(resolveModel(undefined, "@cf/model-not-approved")).toBeNull();
  });
  it("does not silently fall back when an unapproved model is configured", () => expect(resolveModel("invalid-model")).toBeNull());
});

describe("policy: app identifiers", () => {
  it("accepts safe package-like identifiers", () => {
    expect(isValidAppId("com.ciba.zupi")).toBe(true);
    expect(isValidAppId("CIBA_APP.2")).toBe(true);
  });
  it.each(["", "ab", "com.ciba/app", "com ciba", "com.ciba;DROP", "x".repeat(151)])("rejects unsafe identifier %s", (value) => {
    expect(isValidAppId(value)).toBe(false);
  });
});

describe("policy: request throttling", () => {
  it("keeps the per-device minute ceiling at 12", () => expect(MAX_REQUESTS_PER_MINUTE).toBe(12));
});

describe("policy: administrative authentication throttling", () => {
  it("limits failed admin authentication to 10 attempts per minute", () => {
    expect(MAX_ADMIN_AUTH_FAILURES_PER_MINUTE).toBe(10);
  });
});
