import { describe, expect, it } from "vitest";
import { authorizeLearningApiCall, evaluateApiInternalization, validateLearningApiResponse, evaluateIndependentCapability, type CapabilityBehaviorSpec, type LearningApiPolicy, type LearningApiUsage } from "../src/core/learning-api-policy";

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
  it("checks actual response size after receiving the API result", () => {
    expect(validateLearningApiResponse(500, policy)).toEqual({ accepted: true });
    expect(validateLearningApiResponse(20_000, policy)).toMatchObject({ accepted: false, reason: "response_limit" });
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
    requiresLiveService: false, status: "learning" as const,
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

describe("independent capability engineering", () => {
  const spec: CapabilityBehaviorSpec = {
    capability: "document-conversion", purpose: "Convert supported documents",
    inputContract: "Document bytes and target format", outputContract: "Converted document bytes",
    behaviorRules: ["Preserve text and layout"], examples: [{ input: "sample.docx", expectedOutput: "sample.pdf" }],
    edgeCases: ["Empty document", "Unsupported format"], implementationPlan: "Implement parsers and renderers",
    ownApiContract: "POST /convert", ownApiImplementationReference: "src/api/convert.ts",
    testEvidence: ["test:conversion-contract", "test:edge-cases"], testsPassed: true,
    dependsOnLiveExternalData: false,
  };
  it("does not confuse API invocation knowledge with learning the underlying capability", () => {
    expect(evaluateIndependentCapability({ ...spec, ownApiContract: null, ownApiImplementationReference: null, testsPassed: false }))
      .toMatchObject({ learned: true, canBuildOwnApi: true, status: "ready_to_implement" });
  });
  it("marks an independently implemented and tested API as validated", () => {
    expect(evaluateIndependentCapability(spec))
      .toMatchObject({ learned: true, canBuildOwnApi: true, status: "validated" });
  });
  it("recognizes capabilities that fundamentally require live external data", () => {
    expect(evaluateIndependentCapability({ ...spec, dependsOnLiveExternalData: true }))
      .toMatchObject({ learned: true, canBuildOwnApi: false, status: "external_dependency" });
  });
});
