import { describe, expect, it } from "vitest";
import { authorizeLearningApiCall, evaluateApiInternalization, type LearningApiPolicy, type LearningApiUsage } from "../src/core/learning-api-policy";

const policy: LearningApiPolicy = {
  providerId: "sample", pricing: "free_tier", enabled: true,
  maxCallsPerLearningSession: 4, maxCallsPerDay: 10, maxCallsPerMinute: 2,
  maxResponseBytes: 10_000, allowDerivedKnowledge: true, termsReference: "https://example.test/terms",
};
const usage: LearningApiUsage = {
  providerId: "sample", sessionId: "learn-1", day: "2026-11-18",
  minute: "2026-11-18T21:30", callsInSession: 1, callsToday: 2,
  callsThisMinute: 0, responseBytes: 0,
};

describe("learning API limits", () => {
  it("always blocks paid and unknown-price APIs", () => {
    expect(authorizeLearningApiCall({ ...policy, pricing: "paid" }, usage)).toMatchObject({ allowed: false, reason: "paid_api_forbidden" });
    expect(authorizeLearningApiCall({ ...policy, pricing: "unknown" }, usage)).toMatchObject({ allowed: false, reason: "pricing_unknown" });
  });
  it("permits a free-tier call within conservative quotas", () => {
    expect(authorizeLearningApiCall(policy, usage, 500)).toMatchObject({
      allowed: true, remainingSessionCalls: 2, remainingDailyCalls: 7, remainingMinuteCalls: 1,
    });
  });
  it("blocks session, daily, minute and oversized responses", () => {
    expect(authorizeLearningApiCall(policy, { ...usage, callsInSession: 4 })).toMatchObject({ allowed: false, reason: "session_limit" });
    expect(authorizeLearningApiCall(policy, { ...usage, callsToday: 10 })).toMatchObject({ allowed: false, reason: "daily_limit" });
    expect(authorizeLearningApiCall(policy, { ...usage, callsThisMinute: 2 })).toMatchObject({ allowed: false, reason: "minute_limit" });
    expect(authorizeLearningApiCall(policy, usage, 20_000)).toMatchObject({ allowed: false, reason: "response_limit" });
  });
  
});

describe("API learning internalization", () => {
  const artifact = {
    providerId: "sample", capability: "convert-units", learnedAt: "2026-11-18T21:30:00Z",
    documentationReferences: ["https://example.test/docs"], termsReference: "https://example.test/terms", derivedKnowledgePermitted: true,
    learnedProcedure: "Understand request and conversion formula",
    independentImplementationReference: "src/capabilities/unit-converter.ts",
    validationEvidence: ["test:unit-converter"], independentTestPassed: true,
    requiresLiveService: false,
  };
  it("requires a tested independent implementation before reusing without the API", () => {
    expect(evaluateApiInternalization({ ...artifact, independentTestPassed: false }))
      .toMatchObject({ status: "learning", reusableWithoutApi: false });
    expect(evaluateApiInternalization(artifact))
      .toMatchObject({ status: "independent", reusableWithoutApi: true });
  });
  it("blocks assimilation when API terms do not permit derived knowledge", () => {
    expect(evaluateApiInternalization({ ...artifact, derivedKnowledgePermitted: false }))
      .toMatchObject({ status: "blocked", reusableWithoutApi: false });
  });
  it("keeps live-data capabilities marked as external dependencies", () => {
    expect(evaluateApiInternalization({ ...artifact, requiresLiveService: true }))
      .toMatchObject({ status: "external_dependency", reusableWithoutApi: false });
  });
});
