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

function readOwnDataRecord(
  value: unknown,
  allowedKeys: string[],
  requiredKeys: string[] = [],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
      requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotDenseArray(value: unknown, maxLength: number): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > maxLength) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Creates a fail-closed registry for the first planned transcription engine.
 * It does not install whisper.cpp, download model weights, or enable remote
 * processing. Registration is blocked until the engine's license is approved.
 */
export function createWhisperCppRegistry(
  policy: SpeechToTextEnginePolicy,
  adapters: SpeechToTextAdapter[] = [],
): SpeechToTextRegistry {
  const policyFields = readOwnDataRecord(
    policy,
    ["licenseStatus", "supportedRuntimes", "maxAudioBytes", "maxConcurrentTranscriptions"],
    ["licenseStatus", "supportedRuntimes", "maxAudioBytes"]
  );
  if (!policyFields) throw new Error("invalid_speech_to_text_policy");
  const supportedRuntimeValues = snapshotDenseArray(policyFields.supportedRuntimes, 3);
  const supportedRuntimes = supportedRuntimeValues as SpeechToTextRuntime[] | null;
  const validRuntimes = new Set<SpeechToTextRuntime>([
    "android_embedded", "desktop_local", "local_service",
  ]);
  const maxAudioBytes = policyFields.maxAudioBytes;
  const maxConcurrentTranscriptions = policyFields.maxConcurrentTranscriptions;
  if (!supportedRuntimes || !Number.isInteger(maxAudioBytes) ||
      (maxAudioBytes as number) < 1 || (maxAudioBytes as number) > 25 * 1024 * 1024 ||
      supportedRuntimes.length === 0 ||
      supportedRuntimes.some((runtime) => !validRuntimes.has(runtime)) ||
      new Set(supportedRuntimes).size !== supportedRuntimes.length ||
      (maxConcurrentTranscriptions !== undefined &&
        (!Number.isInteger(maxConcurrentTranscriptions) ||
          (maxConcurrentTranscriptions as number) < 1 ||
          (maxConcurrentTranscriptions as number) > 8))) {
    throw new Error("invalid_speech_to_text_policy");
  }
  const licenseApproved = policyFields.licenseStatus === "approved";
  const adapterValues = snapshotDenseArray(adapters, 3);
  if (!adapterValues) throw new Error("invalid_whisper_cpp_adapter");
  if (!licenseApproved && adapterValues.length > 0) {
    throw new Error("speech_to_text_license_not_approved");
  }

  const adapterMap = new Map<SpeechToTextRuntime, SpeechToTextAdapter>();
  const safeMaxAudioBytes = maxAudioBytes as number;
  const maxConcurrent = (maxConcurrentTranscriptions as number | undefined) ?? 1;
  let activeExecutions = 0;
  for (const adapter of adapterValues as SpeechToTextAdapter[]) {
    if (adapter.engine !== "whisper.cpp" ||
        !supportedRuntimes.includes(adapter.runtime) ||
        !adapter.modelId.trim() ||
        adapter.deviceRequirements.runtime !== adapter.runtime ||
        adapterMap.has(adapter.runtime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    try {
      validateDeviceCapabilityRequirements(adapter.deviceRequirements);
    } catch {
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
    maxAudioBytes: safeMaxAudioBytes,
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

function snapshotSpeechToTextRequest(
  value: unknown,
  maxAudioBytes: number,
): SpeechToTextRequest | null {
  try {
    const source = readOwnDataRecord(
      value,
      ["audio", "consent", "mimeType", "language", "timestamps", "signal"],
      ["audio", "consent", "mimeType"]
    );
    if (!source) return null;
    const audio = source.audio;
    const consentValue = source.consent;
    const mimeType = source.mimeType;
    const language = source.language;
    const timestamps = source.timestamps;
    const signal = source.signal;

    if (!(audio instanceof Uint8Array) ||
        Object.getPrototypeOf(audio) !== Uint8Array.prototype ||
        audio.byteLength === 0 || audio.byteLength > maxAudioBytes ||
        typeof mimeType !== "string" || !MIME_TYPES.has(mimeType as SpeechToTextRequest["mimeType"]) ||
        (language !== undefined &&
          (typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language))) ||
        (timestamps !== undefined && typeof timestamps !== "boolean") ||
        (signal !== undefined &&
          (signal === null || typeof signal !== "object" ||
            typeof (signal as AbortSignal).aborted !== "boolean"))) return null;

    const consent = readOwnDataRecord(
      consentValue,
      ["granted", "purpose", "source"],
      ["granted", "purpose", "source"]
    );
    if (!consent) return null;
    const granted = consent.granted;
    const purpose = consent.purpose;
    const sourceAction = consent.source;
    if (granted !== true || purpose !== "transcription" ||
        sourceAction !== "explicit_user_action") return null;

    const audioCopy = Uint8Array.prototype.slice.call(audio) as Uint8Array;
    if (audioCopy.byteLength !== audio.byteLength) return null;
    return {
      audio: audioCopy,
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: mimeType as SpeechToTextRequest["mimeType"],
      ...(language !== undefined ? { language: language as string } : {}),
      ...(timestamps !== undefined ? { timestamps: timestamps as boolean } : {}),
      ...(signal !== undefined ? { signal: signal as AbortSignal } : {}),
    };
  } catch {
    return null;
  }
}

export function validateSpeechToTextRequest(
  request: SpeechToTextRequest,
  maxAudioBytes = 25 * 1024 * 1024,
): void {
  if (!Number.isInteger(maxAudioBytes) || maxAudioBytes < 1) {
    throw new Error("invalid_speech_to_text_request");
  }
  const snapshot = snapshotSpeechToTextRequest(request, maxAudioBytes);
  if (!snapshot) throw new Error("invalid_speech_to_text_request");
  snapshot.audio.fill(0);
}

import { assessDeviceCompatibility, validateDeviceCapabilityRequirements, type DeviceArchitecture, type DeviceCapabilityProfile, type DeviceCapabilityRequirements, type DevicePlatform } from "./device-capabilities";

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
    if (typeof expectedModelId !== "string" || !expectedModelId.trim() ||
        expectedModelId.length > 200) return null;
    const source = readOwnDataRecord(
      value,
      ["engine", "modelId", "text", "language", "segments", "durationMs"],
      ["engine", "modelId", "text", "language", "segments"]
    );
    if (!source) return null;
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

    if (Object.getPrototypeOf(rawSegments) !== Array.prototype) return null;
    const segmentDescriptors = Object.getOwnPropertyDescriptors(rawSegments);
    const segmentCount = rawSegments.length;
    if (!Number.isInteger(segmentCount) || segmentCount < 0 || segmentCount > MAX_SEGMENTS ||
        Reflect.ownKeys(segmentDescriptors).length !== segmentCount + 1) return null;

    const segments: SpeechSegment[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const entry = segmentDescriptors[String(index)];
      if (!entry || !("value" in entry) || !entry.enumerable) return null;
      const segment = readOwnDataRecord(
        entry.value,
        ["startMs", "endMs", "text"],
        ["startMs", "endMs", "text"]
      );
      if (!segment) return null;
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
  const effectiveAudioLimit = maxAudioBytes ?? registry.maxAudioBytes;
  if (!Number.isInteger(effectiveAudioLimit) || effectiveAudioLimit < 1) {
    throw new Error("invalid_speech_to_text_request");
  }
  const safeRequest = snapshotSpeechToTextRequest(
    request,
    Math.min(effectiveAudioLimit, registry.maxAudioBytes)
  );
  if (!safeRequest) throw new Error("invalid_speech_to_text_request");
  const audioBuffer = safeRequest.audio;
  let releaseExecution: (() => void) | undefined;
  try {
    if (safeRequest.signal?.aborted) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    const resolution = resolveWhisperCppRuntime(registry, profile, requirements);
    if (!resolution.available || !resolution.adapter) {
      return { success: false, reasons: resolution.reasons };
    }

    releaseExecution = registry.tryAcquireExecution();
    if (!releaseExecution) {
      return { success: false, reasons: ["transcription_capacity_reached"] };
    }

    const result = await resolution.adapter.transcribe({
      ...safeRequest,
      audio: audioBuffer,
    });
    // An adapter may finish after cancellation if its runtime is not
    // cancellation-aware. Never publish that late result to the caller.
    if (safeRequest.signal?.aborted) {
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
    if (safeRequest.signal?.aborted) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    throw error;
  } finally {
    audioBuffer.fill(0);
    releaseExecution?.();
  }
}
