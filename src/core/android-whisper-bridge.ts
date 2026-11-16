import {
  validateDeviceCapabilityRequirements,
  type DeviceCapabilityRequirements,
  type DeviceArchitecture,
  type DevicePlatform,
} from "./device-capabilities";
import type {
  SpeechToTextAdapter,
  SpeechToTextRequest,
  SpeechToTextResult,
  SpeechSegment,
} from "./speech-to-text";

/**
 * Contract implemented by the Android app's JNI/NDK module.
 * This TypeScript layer never loads native libraries or downloads model files.
 */
export interface AndroidWhisperCppBridgeStatus {
  nativeLibraryReady: boolean;
  modelLoaded: boolean;
  modelId?: string;
  modelSha256?: string;
  engineVersion?: string;
}

export interface AndroidWhisperCppBridge {
  getStatus(): Promise<AndroidWhisperCppBridgeStatus>;
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult>;
}

export interface AndroidWhisperCppAdapterOptions {
  modelId: string;
  modelSha256: string;
  maxAudioBytes: number;
  deviceRequirements: DeviceCapabilityRequirements;
}

/** Creates a fail-closed adapter around an explicitly supplied native bridge. */
export function createAndroidWhisperCppAdapter(
  bridge: AndroidWhisperCppBridge,
  options: AndroidWhisperCppAdapterOptions,
): SpeechToTextAdapter {
  if (options === null || typeof options !== "object" ||
      typeof options.modelId !== "string" || !options.modelId.trim() ||
      typeof options.modelSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(options.modelSha256) ||
      !Number.isInteger(options.maxAudioBytes) ||
      options.maxAudioBytes < 1 ||
      options.deviceRequirements === null ||
      typeof options.deviceRequirements !== "object" ||
      options.deviceRequirements.runtime !== "android_embedded" ||
      bridge === null || typeof bridge !== "object" ||
      typeof bridge.getStatus !== "function" ||
      typeof bridge.transcribe !== "function") {
    throw new Error("invalid_android_whisper_options");
  }
  validateDeviceCapabilityRequirements(options.deviceRequirements);

  // Snapshot caller-owned configuration so later mutations cannot change
  // the selected model, audio limit, or hardware compatibility requirements.
  const modelId = options.modelId;
  const modelSha256 = options.modelSha256;
  const maxAudioBytes = options.maxAudioBytes;
  const deviceRequirements: DeviceCapabilityRequirements = Object.freeze({
    ...options.deviceRequirements,
    ...(options.deviceRequirements.architectures
      ? { architectures: Object.freeze([...options.deviceRequirements.architectures]) as unknown as DeviceArchitecture[] }
      : {}),
    ...(options.deviceRequirements.platforms
      ? { platforms: Object.freeze([...options.deviceRequirements.platforms]) as unknown as DevicePlatform[] }
      : {}),
  });

  // Capture the approved native bridge methods at adapter creation.
  // Later mutations to the caller-owned bridge cannot replace these functions.
  const getStatus = bridge.getStatus.bind(bridge);
  const transcribe = bridge.transcribe.bind(bridge);

  const adapter: SpeechToTextAdapter = {
    engine: "whisper.cpp",
    runtime: "android_embedded",
    modelId,
    deviceRequirements,
    async transcribe(request) {
      if (request === null || typeof request !== "object" ||
          !(request.audio instanceof Uint8Array) ||
          request.audio.byteLength === 0 ||
          request.audio.byteLength > maxAudioBytes) {
        throw new Error("invalid_speech_to_text_request");
      }

      const status = snapshotBridgeStatus(await getStatus());
      if (!status) {
        throw new Error("android_whisper_invalid_status");
      }
      if (!status.nativeLibraryReady) {
        throw new Error("android_whisper_native_library_unavailable");
      }
      if (!status.modelLoaded || status.modelId !== modelId ||
          status.modelSha256 !== modelSha256) {
        throw new Error("android_whisper_model_unavailable");
      }

      // Give JNI its own audio buffer and clear it after the native promise
      // settles, including rejected calls. The caller's buffer stays untouched.
      const nativeAudio = request.audio.slice();
      let result: SpeechToTextResult;
      try {
        result = await transcribe({
          ...request,
          audio: nativeAudio,
        });
      } finally {
        nativeAudio.fill(0);
      }

      if (!isValidResult(result, modelId)) {
        throw new Error("invalid_android_whisper_result");
      }

      // Return a detached immutable snapshot. The native bridge or downstream
      // caller cannot mutate validated text or segment timestamps afterward.
      const segments = Object.freeze(
        result.segments.map((segment) => Object.freeze({ ...segment })),
      );
      return Object.freeze({
        ...result,
        segments,
      }) as SpeechToTextResult;
    },
  };
  return Object.freeze(adapter);
}

function snapshotBridgeStatus(
  value: unknown,
): AndroidWhisperCppBridgeStatus | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const snapshot: AndroidWhisperCppBridgeStatus = {
      nativeLibraryReady: source.nativeLibraryReady as boolean,
      modelLoaded: source.modelLoaded as boolean,
      ...(source.modelId !== undefined ? { modelId: source.modelId as string } : {}),
      ...(source.modelSha256 !== undefined
        ? { modelSha256: source.modelSha256 as string }
        : {}),
      ...(source.engineVersion !== undefined
        ? { engineVersion: source.engineVersion as string }
        : {}),
    };
    if (typeof snapshot.nativeLibraryReady !== "boolean" ||
        typeof snapshot.modelLoaded !== "boolean") {
      return null;
    }
    if (snapshot.modelId !== undefined &&
        (typeof snapshot.modelId !== "string" || snapshot.modelId.length > 200)) {
      return null;
    }
    if (snapshot.modelSha256 !== undefined &&
        (typeof snapshot.modelSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(snapshot.modelSha256))) {
      return null;
    }
    if (snapshot.engineVersion !== undefined &&
        (typeof snapshot.engineVersion !== "string" ||
          snapshot.engineVersion.length > 128)) {
      return null;
    }
    if (snapshot.modelLoaded &&
        (!snapshot.nativeLibraryReady ||
          typeof snapshot.modelId !== "string" || snapshot.modelId.trim().length === 0)) {
      return null;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

const MAX_ANDROID_TRANSCRIPT_CHARS = 100_000;
const MAX_ANDROID_SEGMENTS = 5_000;
const MAX_ANDROID_SEGMENT_TEXT_CHARS = 10_000;

function isValidSegment(segment: SpeechSegment): boolean {
  return segment !== null &&
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.startMs >= 0 &&
    segment.endMs >= segment.startMs &&
    typeof segment.text === "string" &&
    segment.text.length <= MAX_ANDROID_SEGMENT_TEXT_CHARS;
}

function isValidResult(
  result: SpeechToTextResult,
  expectedModelId: string,
): boolean {
  return result !== null &&
    result.engine === "whisper.cpp" &&
    result.modelId === expectedModelId &&
    typeof result.text === "string" &&
    result.text.length <= MAX_ANDROID_TRANSCRIPT_CHARS &&
    typeof result.language === "string" &&
    /^[a-z]{2,3}(-[A-Z]{2})?$/.test(result.language) &&
    Array.isArray(result.segments) &&
    result.segments.length <= MAX_ANDROID_SEGMENTS &&
    result.segments.every(isValidSegment) &&
    (result.durationMs === undefined ||
      (Number.isFinite(result.durationMs) && result.durationMs >= 0 &&
        result.segments.every((segment) => segment.endMs <= result.durationMs!)));
}
