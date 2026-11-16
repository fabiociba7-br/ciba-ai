export type SpeechToTextRuntime = "android_embedded" | "desktop_local" | "local_service";

export interface SpeechToTextConsent {
  granted: true;
  purpose: "transcription";
  source: "explicit_user_action";
}

export interface SpeechToTextRequest {
  audio: Uint8Array;
  consent: SpeechToTextConsent;
  mimeType: "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/webm" | "audio/flac";
  language?: string;
  timestamps?: boolean;
}

export interface SpeechSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SpeechToTextResult {
  text: string;
  language: string;
  durationMs?: number;
  segments: SpeechSegment[];
  engine: "whisper.cpp";
  modelId: string;
}

export interface SpeechToTextAdapter {
  readonly engine: "whisper.cpp";
  readonly runtime: SpeechToTextRuntime;
  readonly modelId: string;
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult>;
}

export interface SpeechToTextEnginePolicy {
  licenseStatus: "review_required" | "approved" | "restricted" | "rejected";
  supportedRuntimes: SpeechToTextRuntime[];
  maxAudioBytes: number;
}

export interface SpeechToTextRegistry {
  getAdapter(runtime: SpeechToTextRuntime): SpeechToTextAdapter | undefined;
  listAvailableRuntimes(): SpeechToTextRuntime[];
}

const MIME_TYPES = new Set<SpeechToTextRequest["mimeType"]>([
  "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm", "audio/flac",
]);

/**
 * Creates a fail-closed registry for the first planned transcription engine.
 * It does not install whisper.cpp, download model weights, or enable remote
 * processing. Registration is blocked until the engine's license is approved.
 */
export function createWhisperCppRegistry(
  policy: SpeechToTextEnginePolicy,
  adapters: SpeechToTextAdapter[] = [],
): SpeechToTextRegistry {
  if (!Number.isInteger(policy.maxAudioBytes) || policy.maxAudioBytes < 1 ||
      !Array.isArray(policy.supportedRuntimes) || policy.supportedRuntimes.length === 0) {
    throw new Error("invalid_speech_to_text_policy");
  }
  if (policy.licenseStatus !== "approved" && adapters.length > 0) {
    throw new Error("speech_to_text_license_not_approved");
  }

  const adapterMap = new Map<SpeechToTextRuntime, SpeechToTextAdapter>();
  for (const adapter of adapters) {
    if (adapter.engine !== "whisper.cpp" ||
        !policy.supportedRuntimes.includes(adapter.runtime) ||
        !adapter.modelId.trim() || adapterMap.has(adapter.runtime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    adapterMap.set(adapter.runtime, adapter);
  }

  return {
    getAdapter: (runtime) => adapterMap.get(runtime),
    listAvailableRuntimes: () => [...adapterMap.keys()],
  };
}

export function validateSpeechToTextRequest(
  request: SpeechToTextRequest,
  maxAudioBytes = 25 * 1024 * 1024,
): void {
  if (!request.consent || request.consent.granted !== true ||
      request.consent.purpose !== "transcription" ||
      request.consent.source !== "explicit_user_action" ||
      !(request.audio instanceof Uint8Array) || request.audio.byteLength === 0 ||
      request.audio.byteLength > maxAudioBytes ||
      !MIME_TYPES.has(request.mimeType) ||
      (request.language !== undefined && !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(request.language))) {
    throw new Error("invalid_speech_to_text_request");
  }
}

import { assessDeviceCompatibility, type DeviceCapabilityProfile, type DeviceCapabilityRequirements } from "./device-capabilities";

export interface SpeechToTextRuntimeResolution {
  available: boolean;
  adapter?: SpeechToTextAdapter;
  reasons: string[];
}

/** Resolves only an already registered adapter after hardware/runtime checks. */
export function resolveWhisperCppRuntime(
  registry: SpeechToTextRegistry,
  profile: DeviceCapabilityProfile,
  requirements: DeviceCapabilityRequirements,
): SpeechToTextRuntimeResolution {
  const decision = assessDeviceCompatibility(profile, requirements);
  if (!decision.compatible) return { available: false, reasons: decision.reasons };
  const runtime = requirements.runtime as SpeechToTextRuntime;
  const adapter = registry.getAdapter(runtime);
  if (!adapter) return { available: false, reasons: ["adapter_not_installed"] };
  return { available: true, adapter, reasons: [] };
}


export type SpeechToTextExecution =
  | { success: true; result: SpeechToTextResult }
  | { success: false; reasons: string[] };

/**
 * Validates and executes one transcription only through a compatible,
 * explicitly registered adapter. It never selects a remote fallback.
 */
export async function runWhisperCppTranscription(
  registry: SpeechToTextRegistry,
  profile: DeviceCapabilityProfile,
  requirements: DeviceCapabilityRequirements,
  request: SpeechToTextRequest,
  maxAudioBytes = 25 * 1024 * 1024,
): Promise<SpeechToTextExecution> {
  validateSpeechToTextRequest(request, maxAudioBytes);
  const resolution = resolveWhisperCppRuntime(registry, profile, requirements);
  if (!resolution.available || !resolution.adapter) {
    return { success: false, reasons: resolution.reasons };
  }

  const result = await resolution.adapter.transcribe(request);
  if (result.engine !== "whisper.cpp" ||
      result.modelId !== resolution.adapter.modelId ||
      typeof result.text !== "string" ||
      typeof result.language !== "string" ||
      !Array.isArray(result.segments) ||
      !result.segments.every((segment) =>
        Number.isFinite(segment.startMs) &&
        Number.isFinite(segment.endMs) &&
        segment.startMs >= 0 &&
        segment.endMs >= segment.startMs &&
        typeof segment.text === "string") ||
      (result.durationMs !== undefined &&
        (!Number.isFinite(result.durationMs) || result.durationMs < 0))) {
    throw new Error("invalid_whisper_cpp_result");
  }
  return { success: true, result };
}
