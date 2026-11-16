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
  /** Hardware floor for this exact model, separate from runtime-level limits. */
  readonly deviceRequirements: DeviceCapabilityRequirements;
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
        !adapter.modelId.trim() ||
        adapter.deviceRequirements.runtime !== adapter.runtime ||
        adapterMap.has(adapter.runtime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    const requirementsSnapshot: DeviceCapabilityRequirements = Object.freeze({
      ...adapter.deviceRequirements,
      ...(adapter.deviceRequirements.architectures
        ? { architectures: Object.freeze([...adapter.deviceRequirements.architectures]) as unknown as DeviceArchitecture[] }
        : {}),
      ...(adapter.deviceRequirements.platforms
        ? { platforms: Object.freeze([...adapter.deviceRequirements.platforms]) as unknown as DevicePlatform[] }
        : {}),
    });
    // Capture the approved implementation itself, not a dynamic property
    // lookup on the caller-owned adapter object.
    const transcribe = adapter.transcribe.bind(adapter);
    const registeredAdapter: SpeechToTextAdapter = Object.freeze({
      engine: adapter.engine,
      runtime: adapter.runtime,
      modelId: adapter.modelId,
      deviceRequirements: requirementsSnapshot,
      transcribe,
    });
    adapterMap.set(adapter.runtime, registeredAdapter);
  }

  // Freeze the public registry surface so callers cannot replace lookup,
  // capacity, or execution-reservation methods after policy validation.
  return Object.freeze({
    maxAudioBytes: policy.maxAudioBytes,
    getAdapter: (runtime: SpeechToTextRuntime) => adapterMap.get(runtime),
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
  });
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

import { assessDeviceCompatibility, type DeviceArchitecture, type DeviceCapabilityProfile, type DeviceCapabilityRequirements, type DevicePlatform } from "./device-capabilities";

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
  const modelDecision = assessDeviceCompatibility(profile, adapter.deviceRequirements);
  if (!modelDecision.compatible) {
    return { available: false, reasons: modelDecision.reasons };
  }
  return { available: true, adapter, reasons: [] };
}


const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_SEGMENTS = 5_000;
const MAX_SEGMENT_TEXT_CHARS = 10_000;

/**
 * Captures untrusted adapter output into a bounded, detached immutable value.
 * Reads accessor-backed fields once and never invokes a caller-owned iterator.
 */
export function snapshotSpeechToTextResult(
  value: unknown,
  expectedModelId: string,
): SpeechToTextResult | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        typeof expectedModelId !== "string" || !expectedModelId.trim()) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const engine = source.engine;
    const modelId = source.modelId;
    const text = source.text;
    const language = source.language;
    const rawSegments = source.segments;
    const durationMs = source.durationMs;
    if (engine !== "whisper.cpp" || modelId !== expectedModelId ||
        typeof text !== "string" || text.length > MAX_TRANSCRIPT_CHARS ||
        typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language) ||
        !Array.isArray(rawSegments) ||
        (durationMs !== undefined &&
          (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0))) {
      return null;
    }

    const segmentCount = rawSegments.length;
    if (!Number.isInteger(segmentCount) || segmentCount < 0 || segmentCount > MAX_SEGMENTS) {
      return null;
    }

    const segments: SpeechSegment[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const rawSegment: unknown = rawSegments[index];
      if (rawSegment === null || typeof rawSegment !== "object" || Array.isArray(rawSegment)) {
        return null;
      }
      const segment = rawSegment as Record<string, unknown>;
      const startMs = segment.startMs;
      const endMs = segment.endMs;
      const segmentText = segment.text;
      if (typeof startMs !== "number" || !Number.isFinite(startMs) || startMs < 0 ||
          typeof endMs !== "number" || !Number.isFinite(endMs) || endMs < startMs ||
          typeof segmentText !== "string" || segmentText.length > MAX_SEGMENT_TEXT_CHARS ||
          (typeof durationMs === "number" && endMs > durationMs)) {
        return null;
      }
      segments.push(Object.freeze({ startMs, endMs, text: segmentText }));
    }

    return Object.freeze({
      engine: "whisper.cpp",
      modelId: expectedModelId,
      text,
      language,
      segments: Object.freeze(segments),
      ...(durationMs !== undefined ? { durationMs } : {}),
    }) as SpeechToTextResult;
  } catch {
    return null;
  }
}

/** Rejects malformed or unbounded output from a local transcription adapter. */
export function validateSpeechToTextResult(
  result: SpeechToTextResult,
  expectedModelId: string,
): void {
  if (!snapshotSpeechToTextResult(result, expectedModelId)) {
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
    // An adapter may finish after cancellation if its runtime is not
    // cancellation-aware. Never publish that late result to the caller.
    if (request.signal?.aborted) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    const resultSnapshot = snapshotSpeechToTextResult(result, resolution.adapter.modelId);
    if (!resultSnapshot) {
      throw new Error("invalid_whisper_cpp_result");
    }
    return { success: true, result: resultSnapshot };
  } catch (error) {
    // Normalize adapter-level cancellation into the same public outcome,
    // while preserving genuine engine failures when no cancellation occurred.
    if (request.signal?.aborted) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    throw error;
  } finally {
    audioBuffer.fill(0);
    releaseExecution();
  }
}
