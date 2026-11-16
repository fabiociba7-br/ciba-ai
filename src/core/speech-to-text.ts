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
  let licenseStatus: SpeechToTextEnginePolicy["licenseStatus"];
  let maxAudioBytes: number;
  let maxConcurrent: number;
  let supportedRuntimes: SpeechToTextRuntime[];
  let adapterSnapshot: SpeechToTextAdapter[];
  try {
    if (policy === null || typeof policy !== "object" || Array.isArray(policy) ||
        !Array.isArray(adapters) || adapters.length > 3) {
      throw new Error("invalid_speech_to_text_policy");
    }
    licenseStatus = policy.licenseStatus;
    maxAudioBytes = policy.maxAudioBytes;
    const configuredConcurrency = policy.maxConcurrentTranscriptions;
    const rawRuntimes = policy.supportedRuntimes;
    if (!Array.isArray(rawRuntimes) || rawRuntimes.length === 0 || rawRuntimes.length > 3) {
      throw new Error("invalid_speech_to_text_policy");
    }
    supportedRuntimes = [];
    for (let index = 0; index < rawRuntimes.length; index += 1) {
      supportedRuntimes.push(rawRuntimes[index]);
    }
    adapterSnapshot = [];
    for (let index = 0; index < adapters.length; index += 1) {
      adapterSnapshot.push(adapters[index]);
    }
    if (!["review_required", "approved", "restricted", "rejected"].includes(licenseStatus) ||
        !Number.isSafeInteger(maxAudioBytes) || maxAudioBytes < 1 ||
        (configuredConcurrency !== undefined &&
          (!Number.isInteger(configuredConcurrency) || configuredConcurrency < 1 || configuredConcurrency > 8))) {
      throw new Error("invalid_speech_to_text_policy");
    }
    maxConcurrent = configuredConcurrency ?? 1;
  } catch (error) {
    if (error instanceof Error &&
        ["invalid_speech_to_text_policy", "speech_to_text_license_not_approved"].includes(error.message)) {
      throw error;
    }
    throw new Error("invalid_speech_to_text_policy");
  }

  const validRuntimes = new Set<SpeechToTextRuntime>([
    "android_embedded", "desktop_local", "local_service",
  ]);
  if (supportedRuntimes.some((runtime) => !validRuntimes.has(runtime)) ||
      new Set(supportedRuntimes).size !== supportedRuntimes.length) {
    throw new Error("invalid_speech_to_text_policy");
  }
  if (licenseStatus !== "approved" && adapterSnapshot.length > 0) {
    throw new Error("speech_to_text_license_not_approved");
  }

  const adapterMap = new Map<SpeechToTextRuntime, SpeechToTextAdapter>();
  let activeExecutions = 0;
  for (const sourceAdapter of adapterSnapshot) {
    try {
      if (sourceAdapter === null || typeof sourceAdapter !== "object" || Array.isArray(sourceAdapter)) {
        throw new Error("invalid_whisper_cpp_adapter");
      }
      const engine = sourceAdapter.engine;
      const runtime = sourceAdapter.runtime;
      const modelId = sourceAdapter.modelId;
      const rawRequirements = sourceAdapter.deviceRequirements;
      const transcribeMethod = sourceAdapter.transcribe;
      if (engine !== "whisper.cpp" ||
          !supportedRuntimes.includes(runtime) ||
          typeof modelId !== "string" || !modelId.trim() || modelId.length > 200 ||
          typeof transcribeMethod !== "function" ||
          rawRequirements === null || typeof rawRequirements !== "object" || Array.isArray(rawRequirements)) {
        throw new Error("invalid_whisper_cpp_adapter");
      }
      const runtimeRequirement = rawRequirements.runtime;
      const minimumRamMb = rawRequirements.minimumRamMb;
      const minimumAvailableRamMb = rawRequirements.minimumAvailableRamMb;
      const minimumCpuCores = rawRequirements.minimumCpuCores;
      const requiresGpu = rawRequirements.requiresGpu;
      const rawArchitectures = rawRequirements.architectures;
      const rawPlatforms = rawRequirements.platforms;
      const minimumAndroidApiLevel = rawRequirements.minimumAndroidApiLevel;
      const architectures = rawArchitectures === undefined ? undefined : [...rawArchitectures];
      const platforms = rawPlatforms === undefined ? undefined : [...rawPlatforms];
      const requirementsSnapshot: DeviceCapabilityRequirements = {
        runtime: runtimeRequirement,
        minimumRamMb,
        ...(minimumAvailableRamMb !== undefined ? { minimumAvailableRamMb } : {}),
        ...(minimumCpuCores !== undefined ? { minimumCpuCores } : {}),
        ...(requiresGpu !== undefined ? { requiresGpu } : {}),
        ...(architectures !== undefined ? { architectures } : {}),
        ...(platforms !== undefined ? { platforms } : {}),
        ...(minimumAndroidApiLevel !== undefined ? { minimumAndroidApiLevel } : {}),
      };
      validateDeviceCapabilityRequirements(requirementsSnapshot);
      if (runtimeRequirement !== runtime || adapterMap.has(runtime)) {
        throw new Error("invalid_whisper_cpp_adapter");
      }
      if (architectures) Object.freeze(architectures);
      if (platforms) Object.freeze(platforms);
      Object.freeze(requirementsSnapshot);
      const transcribe = transcribeMethod.bind(sourceAdapter);
      const registeredAdapter: SpeechToTextAdapter = Object.freeze({
        engine,
        runtime,
        modelId,
        deviceRequirements: requirementsSnapshot,
        transcribe,
      });
      adapterMap.set(runtime, registeredAdapter);
    } catch {
      throw new Error("invalid_whisper_cpp_adapter");
    }
  }

  return Object.freeze({
    maxAudioBytes,
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

import { assessDeviceCompatibility, validateDeviceCapabilityRequirements, type DeviceCapabilityProfile, type DeviceCapabilityRequirements } from "./device-capabilities";

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
