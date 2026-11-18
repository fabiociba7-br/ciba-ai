export type LearningApiPricing = "free" | "free_tier" | "paid" | "unknown";

export interface LearningApiPolicy {
  providerId: string;
  pricing: LearningApiPricing;
  enabled: boolean;
  maxCallsPerLearningSession: number;
  maxCallsPerDay: number;
  maxCallsPerMinute: number;
  maxResponseBytes: number;
  allowDerivedKnowledge: boolean;
  termsReference: string | null;
}

export interface LearningApiUsage {
  providerId: string;
  sessionId: string;
  day: string;
  minute: string;
  callsInSession: number;
  callsToday: number;
  callsThisMinute: number;
  responseBytes: number;
}

export type LearningApiDecision =
  | { allowed: true; remainingSessionCalls: number; remainingDailyCalls: number; remainingMinuteCalls: number }
  | { allowed: false; reason: "paid_api_forbidden" | "pricing_unknown" | "provider_disabled" | "invalid_policy" | "session_limit" | "daily_limit" | "minute_limit" | "response_limit" };

const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 100;
const MAX_CALLS_PER_MINUTE = 5;
const MAX_RESPONSE_BYTES = 256_000;

/** Enforces a hard no-paid-API rule and conservative learning quotas before each external call. Raw responses are not persisted by this policy. */
export function authorizeLearningApiCall(
  policy: LearningApiPolicy,
  usage: LearningApiUsage,
  expectedResponseBytes = 0,
): LearningApiDecision {
  if (!policy || !usage || typeof policy !== "object" || typeof usage !== "object" ||
      !policy.providerId?.trim() || policy.providerId !== usage.providerId ||
      !usage.sessionId?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(usage.day) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(usage.minute) ||
      ![policy.maxCallsPerLearningSession, policy.maxCallsPerDay, policy.maxCallsPerMinute,
        policy.maxResponseBytes, usage.callsInSession, usage.callsToday, usage.callsThisMinute,
        usage.responseBytes, expectedResponseBytes].every(Number.isSafeInteger) ||
      [policy.maxCallsPerLearningSession, policy.maxCallsPerDay, policy.maxCallsPerMinute,
        policy.maxResponseBytes, expectedResponseBytes].some((n) => n < 0) ||
      [usage.callsInSession, usage.callsToday, usage.callsThisMinute, usage.responseBytes].some((n) => n < 0)) {
    return { allowed: false, reason: "invalid_policy" };
  }
  if (policy.pricing === "paid") return { allowed: false, reason: "paid_api_forbidden" };
  if (policy.pricing === "unknown") return { allowed: false, reason: "pricing_unknown" };
  if (!policy.enabled) return { allowed: false, reason: "provider_disabled" };

  const sessionLimit = Math.min(policy.maxCallsPerLearningSession, MAX_CALLS_PER_SESSION);
  const dailyLimit = Math.min(policy.maxCallsPerDay, MAX_CALLS_PER_DAY);
  const minuteLimit = Math.min(policy.maxCallsPerMinute, MAX_CALLS_PER_MINUTE);
  const responseLimit = Math.min(policy.maxResponseBytes, MAX_RESPONSE_BYTES);
  if (expectedResponseBytes > responseLimit) return { allowed: false, reason: "response_limit" };
  if (usage.callsInSession >= sessionLimit) return { allowed: false, reason: "session_limit" };
  if (usage.callsToday >= dailyLimit) return { allowed: false, reason: "daily_limit" };
  if (usage.callsThisMinute >= minuteLimit) return { allowed: false, reason: "minute_limit" };

  return {
    allowed: true,
    remainingSessionCalls: sessionLimit - usage.callsInSession - 1,
    remainingDailyCalls: dailyLimit - usage.callsToday - 1,
    remainingMinuteCalls: minuteLimit - usage.callsThisMinute - 1,
  };
}

/** Rejects oversized or invalid responses after the network adapter receives them. */
export function validateLearningApiResponse(
  responseBytes: number,
  policy: LearningApiPolicy,
): { accepted: true } | { accepted: false; reason: "invalid_response_size" | "response_limit" } {
  if (!Number.isSafeInteger(responseBytes) || responseBytes < 0) {
    return { accepted: false, reason: "invalid_response_size" };
  }
  if (!policy || !Number.isSafeInteger(policy.maxResponseBytes) || policy.maxResponseBytes < 0 ||
      responseBytes > Math.min(policy.maxResponseBytes, MAX_RESPONSE_BYTES)) {
    return { accepted: false, reason: "response_limit" };
  }
  return { accepted: true };
}

export interface ApiLearningArtifact {
  providerId: string;
  capability: string;
  learnedAt: string;
  documentationReferences: string[];
  termsReference: string;
  derivedKnowledgePermitted: boolean;
  learnedProcedure: string;
  independentImplementationReference: string | null;
  validationEvidence: string[];
  independentTestPassed: boolean;
  requiresLiveService: boolean;
  status: "learning" | "independent" | "external_dependency" | "blocked";
}

export interface CapabilityBehaviorSpec {
  capability: string;
  purpose: string;
  inputContract: string;
  outputContract: string;
  behaviorRules: string[];
  examples: Array<{ input: string; expectedOutput: string }>;
  edgeCases: string[];
  implementationPlan: string;
  ownApiContract?: string | null;
  ownApiImplementationReference?: string | null;
  testEvidence: string[];
  testsPassed: boolean;
  dependsOnLiveExternalData: boolean;
}

/**
 * Learning means extracting a permitted behavioral specification and implementing it independently,
 * not merely learning how to invoke the vendor endpoint or copying protected implementation details.
 */
export function evaluateIndependentCapability(
  spec: CapabilityBehaviorSpec,
): { learned: boolean; canBuildOwnApi: boolean; status: "incomplete" | "ready_to_implement" | "validated" | "external_dependency"; reason: string } {
  if (!spec || !spec.capability?.trim() || !spec.purpose?.trim() ||
      !spec.inputContract?.trim() || !spec.outputContract?.trim() ||
      !Array.isArray(spec.behaviorRules) || !Array.isArray(spec.examples) ||
      !Array.isArray(spec.edgeCases) || !spec.implementationPlan?.trim() ||
      !Array.isArray(spec.testEvidence)) {
    return { learned: false, canBuildOwnApi: false, status: "incomplete", reason: "behavioral_specification_incomplete" };
  }
  if (spec.dependsOnLiveExternalData) {
    return { learned: true, canBuildOwnApi: false, status: "external_dependency", reason: "live_external_data_or_service_required" };
  }
  if (spec.examples.length === 0 || spec.behaviorRules.length === 0 || spec.edgeCases.length === 0) {
    return { learned: false, canBuildOwnApi: false, status: "incomplete", reason: "insufficient_behavior_examples" };
  }
  if (!spec.ownApiContract?.trim() || !spec.ownApiImplementationReference?.trim() ||
      !spec.testsPassed || spec.testEvidence.length === 0) {
    return { learned: true, canBuildOwnApi: true, status: "ready_to_implement", reason: "specification_ready_own_api_not_validated" };
  }
  return { learned: true, canBuildOwnApi: true, status: "validated", reason: "independent_api_implementation_tested" };
}

/** External API knowledge is only considered internalized after a separately tested implementation exists. */
export function evaluateApiInternalization(
  artifact: ApiLearningArtifact,
): { status: ApiLearningArtifact["status"]; reusableWithoutApi: boolean; reason: string } {
  if (!artifact || !artifact.providerId?.trim() || !artifact.capability?.trim() ||
      !Number.isFinite(Date.parse(artifact.learnedAt)) ||
      !artifact.termsReference?.trim() || !artifact.learnedProcedure?.trim() ||
      !Array.isArray(artifact.documentationReferences) ||
      !Array.isArray(artifact.validationEvidence)) {
    return { status: "blocked", reusableWithoutApi: false, reason: "invalid_learning_artifact" };
  }
  if (!artifact.termsReference || artifact.documentationReferences.length === 0) {
    return { status: "blocked", reusableWithoutApi: false, reason: "source_or_terms_missing" };
  }
  if (!artifact.derivedKnowledgePermitted) {
    return { status: "blocked", reusableWithoutApi: false, reason: "terms_do_not_allow_derived_knowledge" };
  }
  if (artifact.requiresLiveService) {
    return { status: "external_dependency", reusableWithoutApi: false, reason: "capability_requires_live_external_service" };
  }
  if (!artifact.independentImplementationReference || !artifact.independentTestPassed ||
      artifact.validationEvidence.length === 0) {
    return { status: "learning", reusableWithoutApi: false, reason: "independent_implementation_not_validated" };
  }
  return { status: "independent", reusableWithoutApi: true, reason: "independent_implementation_tested" };
}
