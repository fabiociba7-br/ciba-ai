export type LearningApiPricing = "free" | "free_tier" | "paid" | "unknown";

export interface LearningApiPolicy {
  providerId: string;
  pricing: LearningApiPricing;
  enabled: boolean;
  maxCallsPerLearningSession: number;
  maxCallsPerDay: number;
  maxCallsPerMinute: number;
  maxResponseBytes: number;
  allowDataRetention: boolean;
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
  | { allowed: false; reason: "paid_api_forbidden" | "pricing_unknown" | "provider_disabled" | "invalid_policy" | "session_limit" | "daily_limit" | "minute_limit" | "response_limit" | "retention_not_allowed" };

const MAX_CALLS_PER_SESSION = 20;
const MAX_CALLS_PER_DAY = 100;
const MAX_CALLS_PER_MINUTE = 5;
const MAX_RESPONSE_BYTES = 256_000;

/** Enforces a hard no-paid-API rule and conservative learning quotas before each external call. */
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
  if (!policy.allowDataRetention) return { allowed: false, reason: "retention_not_allowed" };

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

export interface ApiLearningArtifact {
  providerId: string;
  capability: string;
  learnedAt: string;
  documentationReferences: string[];
  termsReference: string;
  learnedProcedure: string;
  independentImplementationReference: string | null;
  validationEvidence: string[];
  independentTestPassed: boolean;
  requiresLiveService: boolean;
  status: "learning" | "independent" | "external_dependency" | "blocked";
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
  if (artifact.requiresLiveService) {
    return { status: "external_dependency", reusableWithoutApi: false, reason: "capability_requires_live_external_service" };
  }
  if (!artifact.independentImplementationReference || !artifact.independentTestPassed ||
      artifact.validationEvidence.length === 0) {
    return { status: "learning", reusableWithoutApi: false, reason: "independent_implementation_not_validated" };
  }
  return { status: "independent", reusableWithoutApi: true, reason: "independent_implementation_tested" };
}
