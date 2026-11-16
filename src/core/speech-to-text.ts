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

function readAbortSignalAborted(value: unknown): boolean | null {
  try {
    if (typeof AbortSignal === "undefined" || value === null || typeof value !== "object" ||
        Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
    if (typeof getter !== "function") return null;
    const result = getter.call(value);
    return typeof result === "boolean" ? result : null;
  } catch {
    return null;
  }
}

function readUint8ArrayByteLength(value: unknown): number | null {
  try {
    if (value === null || typeof value !== "object" || !ArrayBuffer.isView(value)) return null;
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const tagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
    const getter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
    if (typeof tagGetter !== "function" || tagGetter.call(value) !== "Uint8Array" ||
        typeof getter !== "function") return null;
    const length = getter.call(value);
    return Number.isSafeInteger(length) && length >= 0 ? length : null;
  } catch {
    return null;
  }
}

interface SafeSpeechToTextRegistry {
  maxAudioBytes: number;
  getAdapter: SpeechToTextRegistry["getAdapter"];
  tryAcquireExecution: SpeechToTextRegistry["tryAcquireExecution"];
}

function snapshotSpeechToTextRegistry(value: unknown): SafeSpeechToTextRegistry | null {
  try {
    const fields = readOwnDataRecord(
      value,
      ["maxAudioBytes", "getAdapter", "listAvailableRuntimes", "tryAcquireExecution"],
      ["maxAudioBytes", "getAdapter", "listAvailableRuntimes", "tryAcquireExecution"]
    );
    if (!fields || !Number.isInteger(fields.maxAudioBytes) ||
        (fields.maxAudioBytes as number) < 1 ||
        (fields.maxAudioBytes as number) > 25 * 1024 * 1024 ||
        typeof fields.getAdapter !== "function" ||
        typeof fields.listAvailableRuntimes !== "function" ||
        typeof fields.tryAcquireExecution !== "function") return null;
    return {
      maxAudioBytes: fields.maxAudioBytes as number,
      getAdapter: fields.getAdapter as SpeechToTextRegistry["getAdapter"],
      tryAcquireExecution: fields.tryAcquireExecution as SpeechToTextRegistry["tryAcquireExecution"],
    };
  } catch {
    return null;
  }
}

function snapshotRegisteredAdapter(
  value: unknown,
  expectedRuntime: SpeechToTextRuntime,
): SpeechToTextAdapter | null {
  try {
    const fields = readOwnDataRecord(
      value,
      ["engine", "runtime", "modelId", "deviceRequirements", "transcribe"],
      ["engine", "runtime", "modelId", "deviceRequirements", "transcribe"]
    );
    if (!fields || fields.engine !== "whisper.cpp" || fields.runtime !== expectedRuntime ||
        typeof fields.modelId !== "string" || !fields.modelId.trim() ||
        fields.modelId.length > 200 || typeof fields.transcribe !== "function") return null;
    const raw = readOwnDataRecord(
      fields.deviceRequirements,
      ["runtime", "minimumRamMb", "minimumAvailableRamMb", "minimumCpuCores",
        "requiresGpu", "architectures", "platforms", "minimumAndroidApiLevel"],
      ["runtime", "minimumRamMb"]
    );
    if (!raw || raw.runtime !== expectedRuntime) return null;
    const architectures = raw.architectures === undefined ? undefined
      : snapshotDenseArray(raw.architectures, 5);
    const platforms = raw.platforms === undefined ? undefined
      : snapshotDenseArray(raw.platforms, 5);
    if ((raw.architectures !== undefined && !architectures) ||
        (raw.platforms !== undefined && !platforms)) return null;
    const deviceRequirements: DeviceCapabilityRequirements = Object.freeze({
      runtime: raw.runtime as DeviceCapabilityRequirements["runtime"],
      minimumRamMb: raw.minimumRamMb as number,
      ...(raw.minimumAvailableRamMb === undefined ? {} : { minimumAvailableRamMb: raw.minimumAvailableRamMb as number }),
      ...(raw.minimumCpuCores === undefined ? {} : { minimumCpuCores: raw.minimumCpuCores as number }),
      ...(raw.requiresGpu === undefined ? {} : { requiresGpu: raw.requiresGpu as boolean }),
      ...(architectures === undefined ? {} : { architectures: Object.freeze(architectures) as unknown as DeviceArchitecture[] }),
      ...(platforms === undefined ? {} : { platforms: Object.freeze(platforms) as unknown as DevicePlatform[] }),
      ...(raw.minimumAndroidApiLevel === undefined ? {} : { minimumAndroidApiLevel: raw.minimumAndroidApiLevel as number }),
    });
    validateDeviceCapabilityRequirements(deviceRequirements);
    const transcribe = (fields.transcribe as SpeechToTextAdapter["transcribe"]).bind(value);
    return Object.freeze({
      engine: "whisper.cpp",
      runtime: expectedRuntime,
      modelId: fields.modelId,
      deviceRequirements,
      transcribe,
    });
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
  for (const adapterValue of adapterValues) {
    const adapter = readOwnDataRecord(
      adapterValue,
      ["engine", "runtime", "modelId", "deviceRequirements", "transcribe"],
      ["engine", "runtime", "modelId", "deviceRequirements", "transcribe"]
    );
    if (!adapter || adapter.engine !== "whisper.cpp" ||
        typeof adapter.runtime !== "string" ||
        !validRuntimes.has(adapter.runtime as SpeechToTextRuntime) ||
        !supportedRuntimes.includes(adapter.runtime as SpeechToTextRuntime) ||
        typeof adapter.modelId !== "string" || !adapter.modelId.trim() ||
        adapter.modelId.length > 200 || typeof adapter.transcribe !== "function" ||
        adapterMap.has(adapter.runtime as SpeechToTextRuntime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }

    const rawRequirements = readOwnDataRecord(
      adapter.deviceRequirements,
      ["runtime", "minimumRamMb", "minimumAvailableRamMb", "minimumCpuCores",
        "requiresGpu", "architectures", "platforms", "minimumAndroidApiLevel"],
      ["runtime", "minimumRamMb"]
    );
    if (!rawRequirements) throw new Error("invalid_whisper_cpp_adapter");
    const architectures = rawRequirements.architectures === undefined
      ? undefined
      : snapshotDenseArray(rawRequirements.architectures, 5);
    const platforms = rawRequirements.platforms === undefined
      ? undefined
      : snapshotDenseArray(rawRequirements.platforms, 5);
    if ((rawRequirements.architectures !== undefined && !architectures) ||
        (rawRequirements.platforms !== undefined && !platforms)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    const requirementsSnapshot: DeviceCapabilityRequirements = Object.freeze({
      runtime: rawRequirements.runtime as DeviceCapabilityRequirements["runtime"],
      minimumRamMb: rawRequirements.minimumRamMb as number,
      ...(rawRequirements.minimumAvailableRamMb === undefined ? {} : {
        minimumAvailableRamMb: rawRequirements.minimumAvailableRamMb as number
      }),
      ...(rawRequirements.minimumCpuCores === undefined ? {} : {
        minimumCpuCores: rawRequirements.minimumCpuCores as number
      }),
      ...(rawRequirements.requiresGpu === undefined ? {} : {
        requiresGpu: rawRequirements.requiresGpu as boolean
      }),
      ...(architectures === undefined ? {} : {
        architectures: Object.freeze(architectures) as unknown as DeviceArchitecture[]
      }),
      ...(platforms === undefined ? {} : {
        platforms: Object.freeze(platforms) as unknown as DevicePlatform[]
      }),
      ...(rawRequirements.minimumAndroidApiLevel === undefined ? {} : {
        minimumAndroidApiLevel: rawRequirements.minimumAndroidApiLevel as number
      })
    });
    if (requirementsSnapshot.runtime !== adapter.runtime) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    try {
      validateDeviceCapabilityRequirements(requirementsSnapshot);
    } catch {
      throw new Error("invalid_whisper_cpp_adapter");
    }

    const runtime = adapter.runtime as SpeechToTextRuntime;
    const modelId = adapter.modelId;
    // Capture the approved implementation once; never resolve it dynamically.
    const transcribe = (adapter.transcribe as SpeechToTextAdapter["transcribe"]).bind(adapterValue);
    const registeredAdapter: SpeechToTextAdapter = Object.freeze({
      engine: "whisper.cpp",
      runtime,
      modelId,
      deviceRequirements: requirementsSnapshot,
      transcribe,
    });
    adapterMap.set(runtime, registeredAdapter);
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

    const audioByteLength = readUint8ArrayByteLength(audio);
    if (audioByteLength === null ||
        audioByteLength === 0 || audioByteLength > maxAudioBytes ||
        typeof mimeType !== "string" || !MIME_TYPES.has(mimeType as SpeechToTextRequest["mimeType"]) ||
        (language !== undefined &&
          (typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language))) ||
        (timestamps !== undefined && typeof timestamps !== "boolean") ||
        (signal !== undefined && readAbortSignalAborted(signal) === null)) return null;

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

    // Avoid TypedArray species/constructor hooks and shadowed byteLength accessors.
    const audioCopy = new Uint8Array(audioByteLength);
    Uint8Array.prototype.set.call(audioCopy, audio as Uint8Array);
    if (audioCopy.byteLength !== audioByteLength) return null;
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
  const safeRegistry = snapshotSpeechToTextRegistry(registry);
  if (!safeRegistry) return { available: false, reasons: ["invalid_speech_to_text_registry"] };
  const decision = assessDeviceCompatibility(profile, requirements);
  if (!decision.compatible) return { available: false, reasons: decision.reasons };
  const runtime = requirements.runtime as SpeechToTextRuntime;
  let adapterValue: unknown;
  try {
    adapterValue = safeRegistry.getAdapter(runtime);
  } catch {
    return { available: false, reasons: ["adapter_lookup_failed"] };
  }
  if (adapterValue === undefined) return { available: false, reasons: ["adapter_not_installed"] };
  const adapter = snapshotRegisteredAdapter(adapterValue, runtime);
  if (!adapter) return { available: false, reasons: ["invalid_whisper_cpp_adapter"] };
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
function readAccessorSnapshotRecord(
  value: unknown,
  allowedKeys: string[],
  requiredKeys: string[],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
        requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor) return null;
      if ("value" in descriptor) {
        if (!descriptor.enumerable) return null;
        result[key] = descriptor.value;
      } else {
        if (typeof descriptor.get !== "function" || descriptor.set !== undefined) return null;
        result[key] = descriptor.get.call(value);
      }
    }
    return result;
  } catch {
    return null;
  }
}

export function snapshotSpeechToTextResult(
  value: unknown,
  expectedModelId: string,
): SpeechToTextResult | null {
  try {
    if (typeof expectedModelId !== "string" || !expectedModelId.trim() ||
        expectedModelId.length > 200) return null;
    const source = readAccessorSnapshotRecord(
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
      const segmentValue = rawSegments[index];
      if (segmentValue !== entry.value) return null;
      const segment = readAccessorSnapshotRecord(
        segmentValue,
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
  const safeRegistry = snapshotSpeechToTextRegistry(registry);
  if (!safeRegistry) throw new Error("invalid_speech_to_text_registry");
  const effectiveAudioLimit = maxAudioBytes ?? safeRegistry.maxAudioBytes;
  if (!Number.isInteger(effectiveAudioLimit) || effectiveAudioLimit < 1) {
    throw new Error("invalid_speech_to_text_request");
  }
  const safeRequest = snapshotSpeechToTextRequest(
    request,
    Math.min(effectiveAudioLimit, safeRegistry.maxAudioBytes)
  );
  if (!safeRequest) throw new Error("invalid_speech_to_text_request");
  const audioBuffer = safeRequest.audio;
  let releaseExecution: (() => void) | undefined;
  try {
    if (safeRequest.signal !== undefined && readAbortSignalAborted(safeRequest.signal) !== false) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    const resolution = resolveWhisperCppRuntime(registry, profile, requirements);
    if (!resolution.available || !resolution.adapter) {
      return { success: false, reasons: resolution.reasons };
    }

    releaseExecution = safeRegistry.tryAcquireExecution();
    if (!releaseExecution) {
      return { success: false, reasons: ["transcription_capacity_reached"] };
    }

    const result = await resolution.adapter.transcribe({
      ...safeRequest,
      audio: audioBuffer,
    });
    // An adapter may finish after cancellation if its runtime is not
    // cancellation-aware. Never publish that late result to the caller.
    if (safeRequest.signal !== undefined && readAbortSignalAborted(safeRequest.signal) !== false) {
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
    if (safeRequest.signal !== undefined && readAbortSignalAborted(safeRequest.signal) !== false) {
      return { success: false, reasons: ["transcription_cancelled"] };
    }
    throw error;
  } finally {
    audioBuffer.fill(0);
    releaseExecution?.();
  }
}
