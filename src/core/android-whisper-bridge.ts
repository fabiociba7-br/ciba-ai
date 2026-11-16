import type { DeviceCapabilityRequirements } from "./device-capabilities";
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
  engineVersion?: string;
}

export interface AndroidWhisperCppBridge {
  getStatus(): Promise<AndroidWhisperCppBridgeStatus>;
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult>;
}

export interface AndroidWhisperCppAdapterOptions {
  modelId: string;
  maxAudioBytes: number;
  deviceRequirements: DeviceCapabilityRequirements;
}

/** Creates a fail-closed adapter around an explicitly supplied native bridge. */
export function createAndroidWhisperCppAdapter(
  bridge: AndroidWhisperCppBridge,
  options: AndroidWhisperCppAdapterOptions,
): SpeechToTextAdapter {
  if (!options.modelId.trim() ||
      !Number.isInteger(options.maxAudioBytes) ||
      options.maxAudioBytes < 1 ||
      options.deviceRequirements.runtime !== "android_embedded") {
    throw new Error("invalid_android_whisper_options");
  }

  // Capture the approved native bridge methods at adapter creation.
  // Later mutations to the caller-owned bridge cannot replace these functions.
  const getStatus = bridge.getStatus.bind(bridge);
  const transcribe = bridge.transcribe.bind(bridge);

  return {
    engine: "whisper.cpp",
    runtime: "android_embedded",
    modelId: options.modelId,
    deviceRequirements: options.deviceRequirements,
    async transcribe(request) {
      if (!(request.audio instanceof Uint8Array) ||
          request.audio.byteLength === 0 ||
          request.audio.byteLength > options.maxAudioBytes) {
        throw new Error("invalid_speech_to_text_request");
      }

      const status = await getStatus();
      if (!status.nativeLibraryReady) {
        throw new Error("android_whisper_native_library_unavailable");
      }
      if (!status.modelLoaded || status.modelId !== options.modelId) {
        throw new Error("android_whisper_model_unavailable");
      }

      const result = await transcribe(request);
      if (!isValidResult(result, options.modelId)) {
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
