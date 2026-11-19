export { runCibaOrchestrator } from "./orchestrator";
export { runMultiModelEnsemble } from "./ensemble";
export type { EnsembleMember, EnsemblePlan, EnsembleResult } from "./ensemble";
export { listAgents } from "./agents/catalog";
export { routeTask } from "./router";
export { CloudflareWorkersAIProvider } from "./providers/cloudflare";
export { OpenAICompatibleProvider } from "./providers/openai-compatible";
export { createProviderRegistry } from "./providers/registry";
export type { ProviderRegistry, RegisteredModel } from "./providers/registry";
export type { CibaToolDefinition, CibaToolMetadata, CibaToolModelDescriptor, CibaToolRegistry, CibaToolRisk } from "./tools";
export { createCibaToolRegistry, createCibaToolConsentStore, createCibaToolApprovalFlow, createD1ToolApprovalStore, createDurableCibaToolApprovalFlow } from "./tools";
export { createGarciaCapabilityTools, createGarciaCapabilityToolRuntime } from "./tools";
export type { GarciaCapabilityToolAuthorizer, GarciaCapabilityToolOptions, GarciaCapabilityToolRuntime, GarciaCapabilityToolRuntimeOptions } from "./tools";
export type { CibaToolAuthorizationRequest, CibaToolInvocationPlan, CibaToolInvocationContext, CibaToolRegistryOptions, ExecutableCibaToolRegistry, CibaToolConsentRequest, CibaToolConsentCheck, CibaToolConsentStatus, CibaToolConsentStore, CibaToolApprovalFlow, CibaToolApprovalState, CibaToolProposal, DurableToolApprovalIdentity, DurableToolApprovalRequest, DurableToolApprovalResult, DurableToolApprovalStatus, DurableToolApprovalStore, DurableCibaToolApprovalFlow, DurableCibaToolProposal, DurableCibaToolApprovalState } from "./tools";
export type { CibaRole, ChatTurn, ModelProvider, OrchestrationResult } from "./types";
export { parseCibaToolModelProposal, CIBA_TOOL_PROPOSAL_PREFIX } from "./tools/model-proposal";
export type { CibaToolModelProposal } from "./tools/model-proposal";

export { buildWorkingContext, canAccessMemory, validateCuratedMemory, validateMemoryRecord } from "./memory";
export type { MemoryAccessRequest, MemoryConsent, MemoryGrant, MemoryPermission, MemoryRecord, MemoryScope, MemoryStore } from "./memory";

export { canRelayAppMessage, validateAppMessageEnvelope, validateAppMessageGrant } from "./messaging";
export type { AppMessageAccessRequest, AppMessageEnvelope, AppMessageGrant, AppMessagePermission, AppMessageScope } from "./messaging";

export { canDeviceActForOwner, canPairDevice, canUseOwnerPairingInvitation, validateOwnerPairingInvitation } from "./owner";
export type { OwnerBoundDevice, OwnerIdentity, OwnerPairingInvitation, OwnerStatus } from "./owner";

export { canUseAppAccessGrant, validateAppAccessGrant } from "./access-grants";
export type { AppAccessGrant, AppAccessPermission, AppAccessRequest, AppAccessScope } from "./access-grants";

export { APP_TYPES, APP_CAPABILITIES, APP_TASK_TYPES, validateAppProfile, parseStoredAppCapabilities, parseStoredAppTaskTypes } from "./apps/registry";
export type { AppType, AppCapability, AppTaskType, AppIdentityProfile, AppProfileInput } from "./apps/registry";

export { GARCIA_NATIVE_CAPABILITIES, createNativeCapabilityRegistry } from "./native-capabilities";
export type { NativeCapabilityAdapter, NativeCapabilityCategory, NativeCapabilityDefinition, NativeCapabilityLicenseStatus, NativeCapabilityRegistry, NativeCapabilityRuntime, NativeCapabilityStatus } from "./native-capabilities";

export { createWhisperCppRegistry, validateSpeechToTextRequest, resolveWhisperCppRuntime, runWhisperCppTranscription } from "./speech-to-text";
export type { SpeechToTextRuntimeResolution, SpeechToTextExecution } from "./speech-to-text";
export type { SpeechToTextAdapter, SpeechToTextConsent, SpeechToTextEnginePolicy, SpeechToTextRegistry, SpeechToTextRequest, SpeechToTextResult, SpeechSegment, SpeechToTextRuntime } from "./speech-to-text";

export { assessDeviceCompatibility, validateDeviceCapabilityProfile, validateDeviceCapabilityRequirements } from "./device-capabilities";
export type { DeviceArchitecture, DeviceCapabilityDecision, DeviceCapabilityProfile, DeviceCapabilityRequirements, DevicePlatform, DeviceRuntime } from "./device-capabilities";

export { createAndroidWhisperCppAdapter } from "./android-whisper-bridge";
export type { AndroidWhisperCppAdapterOptions, AndroidWhisperCppBridge, AndroidWhisperCppBridgeStatus } from "./android-whisper-bridge";

export { createChatterboxRegistry, validateTextToSpeechRequest, runChatterboxSynthesis } from "./text-to-speech";
export type { TextToSpeechRuntime, TextToSpeechConsent, TextToSpeechRequest, TextToSpeechResult, TextToSpeechAdapter, TextToSpeechEnginePolicy, TextToSpeechRegistry } from "./text-to-speech";

export { createDesktopChatterboxAdapter } from "./desktop-chatterbox-bridge";
export type { DesktopChatterboxAdapterOptions, DesktopChatterboxBridge, DesktopChatterboxBridgeStatus } from "./desktop-chatterbox-bridge";

export { evaluateKnowledge, isKnowledgeCurrent, recordKnowledgeOutcome, learnFromResearch } from "./knowledge-learning";
export type { KnowledgeDecision, KnowledgeEvidence, KnowledgeEvidenceKind, KnowledgeRecord, KnowledgeStatus, ResearchSource, ResearchLearningEntry, ResearchKnowledgeRepository, ResearchLearningInput } from "./knowledge-learning";

export { authorizeLearningApiCall, evaluateApiInternalization, evaluateIndependentCapability, validateLearningApiResponse } from "./learning-api-policy";
export type { LearningApiPricing, LearningApiPolicy, LearningApiUsage, LearningApiDecision, ApiLearningArtifact } from "./learning-api-policy";
export type { CapabilityBehaviorSpec } from "./learning-api-policy";

export { createD1StorageOutbox } from "./storage-outbox";
export type { GarciaStorageDestination, StorageOutboxEvent, StorageOutboxInput } from "./storage-outbox";


export { createD1FileCatalog, createR2ObjectStore, validateGarciaFileInput } from "./storage-contracts";
export { createGarciaFileLifecycle } from "./storage/file-lifecycle";
export type { GarciaFileUploadInput, GarciaFileDownload } from "./storage/file-lifecycle";
export type { GarciaStorageProvider, GarciaFileStatus, GarciaFileMetadata, GarciaFileCreateInput, GarciaFileCatalog, GarciaObjectStore, R2BucketLike } from "./storage-contracts";


export { createD1ResearchKnowledgeRepository } from "./research-repository";
