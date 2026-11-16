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
  signal?: AbortSignal;
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
  maxConcurrentTranscriptions?: number;
}

export interface SpeechToTextRegistry {
  readonly maxAudioBytes: number;
  getAdapter(runtime: SpeechToTextRuntime): SpeechToTextAdapter | undefined;
  listAvailableRuntimes(): SpeechToTextRuntime[];
  tryAcquireExecution(): (() => void) | undefined;
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
      !Array.isArray(policy.supportedRuntimes) || policy.supportedRuntimes.length === 0 ||
      (policy.maxConcurrentTranscriptions !== undefined &&
        (!Number.isInteger(policy.maxConcurrentTranscriptions) || policy.maxConcurrentTranscriptions < 1 || policy.maxConcurrentTranscriptions > 8))) {
    throw new Error("invalid_speech_to_text_policy");
  }
  if (policy.licenseStatus !== "approved" && adapters.length > 0) {
    throw new Error("speech_to_text_license_not_approved");
  }

  const adapterMap = new Map<SpeechToTextRuntime, SpeechToTextAdapter>();
  const maxConcurrent = policy.maxConcurrentTranscriptions ?? 1;
  let activeExecutions = 0;
  for (const adapter of adapters) {
    if (adapter.engine !== "whisper.cpp" ||
        !policy.supportedRuntimes.includes(adapter.runtime) ||
        !adapter.modelId.trim() || adapterMap.has(adapter.runtime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    adapterMap.set(adapter.runtime, adapter);
  }

  return {
    maxAudioBytes: policy.maxAudioBytes,
    getAdapter: (runtime) => adapterMap.get(runtime),
    listAvailableRuntimes: () => [...adapterMap.keys()],
    tryAcquireExecution: () => {
      if (activeExecutions >= maxConcurrent) return undefined;
      activeExecutions += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeExecutions -= 1;
      };
    },
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


const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_SEGMENTS = 5_000;
const MAX_SEGMENT_TEXT_CHARS = 10_000;

/** Rejects malformed or unbounded output from a local transcription adapter. */
export function validateSpeechToTextResult(
  result: SpeechToTextResult,
  expectedModelId: string,
): void {
  if (!result || result.engine !== "whisper.cpp" ||
      result.modelId !== expectedModelId ||
      typeof result.text !== "string" || result.text.length > MAX_TRANSCRIPT_CHARS ||
      typeof result.language !== "string" ||
      !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(result.language) ||
      !Array.isArray(result.segments) || result.segments.length > MAX_SEGMENTS ||
      !result.segments.every((segment) =>
        segment !== null &&
        Number.isFinite(segment.startMs) &&
        Number.isFinite(segment.endMs) &&
        segment.startMs >= 0 &&
        segment.endMs >= segment.startMs &&
        typeof segment.text === "string" &&
        segment.text.length <= MAX_SEGMENT_TEXT_CHARS) ||
      (result.durationMs !== undefined &&
        (!Number.isFinite(result.durationMs) || result.durationMs < 0 ||
          result.segments.some((segment) => segment.endMs > result.durationMs!)))) {
    throw new Error("invalid_whisper_cpp_result");
  }
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
  maxAudioBytes?: number,
): Promise<SpeechToTextExecution> {
  validateSpeechToTextRequest(request, maxAudioBytes ?? registry.maxAudioBytes);
  if (request.signal?.aborted) {
    return { success: false, reasons: ["transcription_cancelled"] };
  }
  const resolution = resolveWhisperCppRuntime(registry, profile, requirements);
  if (!resolution.available || !resolution.adapter) {
    return { success: false, reasons: resolution.reasons };
  }

  const releaseExecution = registry.tryAcquireExecution();
  if (!releaseExecution) {
    return { success: false, reasons: ["transcription_capacity_reached"] };
  }

  // Give the adapter an isolated copy and clear it after completion so the
  // caller's audio remains untouched and the temporary buffer is not retained.
  const audioBuffer = request.audio.slice();
  try {
    if (request.signal?.aborted) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    const result = await resolution.adapter.transcribe({
      ...request,
      audio: audioBuffer,
    });
    validateSpeechToTextResult(result, resolution.adapter.modelId);
    return { success: true, result };
  } finally {
    audioBuffer.fill(0);
    releaseExecution();
  }
}
