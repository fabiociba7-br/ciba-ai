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
