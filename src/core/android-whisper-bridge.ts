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
  if (!options.modelId.trim() ||
      !/^[a-f0-9]{64}$/.test(options.modelSha256) ||
      !Number.isInteger(options.maxAudioBytes) ||
      options.maxAudioBytes < 1 ||
      options.deviceRequirements.runtime !== "android_embedded") {
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
      if (!(request.audio instanceof Uint8Array) ||
          request.audio.byteLength === 0 ||
          request.audio.byteLength > maxAudioBytes) {
        throw new Error("invalid_speech_to_text_request");
      }

      const status = await getStatus();
      if (!isValidBridgeStatus(status)) {
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

function isValidBridgeStatus(
  status: AndroidWhisperCppBridgeStatus,
): boolean {
  if (status === null ||
      typeof status.nativeLibraryReady !== "boolean" ||
      typeof status.modelLoaded !== "boolean") {
    return false;
  }
  if (status.modelId !== undefined &&
      (typeof status.modelId !== "string" || status.modelId.length > 200)) {
    return false;
  }
  if (status.modelSha256 !== undefined &&
      (typeof status.modelSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(status.modelSha256))) {
    return false;
  }
  if (status.engineVersion !== undefined &&
      (typeof status.engineVersion !== "string" || status.engineVersion.length > 128)) {
    return false;
  }
  if (status.modelLoaded &&
      (!status.nativeLibraryReady ||
        typeof status.modelId !== "string" || status.modelId.trim().length === 0 ||
        typeof status.modelSha256 !== "string")) {
    return false;
  }
  return true;
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
