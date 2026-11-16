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

  return {
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
      if (!status.nativeLibraryReady) {
        throw new Error("android_whisper_native_library_unavailable");
      }
      if (!status.modelLoaded || status.modelId !== modelId ||
          status.modelSha256 !== modelSha256) {
        throw new Error("android_whisper_model_unavailable");
      }

      const result = await transcribe(request);
      if (!isValidResult(result, modelId)) {
        throw new Error("invalid_android_whisper_result");
      }
      return result;
    },
  };
}

function isValidSegment(segment: SpeechSegment): boolean {
  return Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.startMs >= 0 &&
    segment.endMs >= segment.startMs &&
    typeof segment.text === "string";
}

function isValidResult(
  result: SpeechToTextResult,
  expectedModelId: string,
): boolean {
  return result.engine === "whisper.cpp" &&
    result.modelId === expectedModelId &&
    typeof result.text === "string" &&
    typeof result.language === "string" &&
    Array.isArray(result.segments) &&
    result.segments.every(isValidSegment) &&
    (result.durationMs === undefined ||
      (Number.isFinite(result.durationMs) && result.durationMs >= 0));
}
