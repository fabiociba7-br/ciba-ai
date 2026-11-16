function snapshotTranscriptionResult(
  value: unknown,
  expectedModelId: string,
): SpeechToTextResult | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    // Read every result field once, including the segments collection.
    const engine = source.engine;
    const modelId = source.modelId;
    const text = source.text;
    const language = source.language;
    const rawSegments = source.segments;
    const durationMs = source.durationMs;
    if (engine !== "whisper.cpp" || modelId !== expectedModelId ||
        typeof text !== "string" || text.length > MAX_ANDROID_TRANSCRIPT_CHARS ||
        typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language) ||
        !Array.isArray(rawSegments) ||
        (durationMs !== undefined &&
          (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0))) {
      return null;
    }

    // Capture the collection size once and read each indexed entry once.
    // Do not invoke a caller-controlled Symbol.iterator at this native boundary.
    const segmentCount = rawSegments.length;
    if (!Number.isInteger(segmentCount) || segmentCount < 0 ||
        segmentCount > MAX_ANDROID_SEGMENTS) {
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
          typeof segmentText !== "string" ||
          segmentText.length > MAX_ANDROID_SEGMENT_TEXT_CHARS ||
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
      ...(durationMs !== undefined ? { durationMs: durationMs as number } : {}),
    }) as SpeechToTextResult;
  } catch {
    // Malformed objects and throwing getters fail closed at the native boundary.
    return null;
  }
}import {
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
      options.maxAudioBytes < 1 || options.maxAudioBytes > 25 * 1024 * 1024 ||
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
      const requestSnapshot = snapshotAndroidTranscriptionRequest(request, maxAudioBytes);
      if (!requestSnapshot) {
        throw new Error("invalid_speech_to_text_request");
      }

      // The isolated audio copy is cleared on every exit path, including
      // failures while reading or validating the native bridge status.
      const nativeAudio = requestSnapshot.audio;
      let result: SpeechToTextResult;
      try {
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

        result = await transcribe({
          ...requestSnapshot,
          audio: nativeAudio,
        });
      } finally {
        nativeAudio.fill(0);
      }

      const snapshot = snapshotTranscriptionResult(result, modelId);
      if (!snapshot) {
        throw new Error("invalid_android_whisper_result");
      }
      return snapshot;
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
    // Read each potentially accessor-backed field exactly once. This prevents
    // getters with side effects from changing the value between checks.
    const nativeLibraryReady = source.nativeLibraryReady;
    const modelLoaded = source.modelLoaded;
    const modelId = source.modelId;
    const modelSha256 = source.modelSha256;
    const engineVersion = source.engineVersion;
    const snapshot: AndroidWhisperCppBridgeStatus = {
      nativeLibraryReady: nativeLibraryReady as boolean,
      modelLoaded: modelLoaded as boolean,
      ...(modelId !== undefined ? { modelId: modelId as string } : {}),
      ...(modelSha256 !== undefined ? { modelSha256: modelSha256 as string } : {}),
      ...(engineVersion !== undefined ? { engineVersion: engineVersion as string } : {}),
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


const ANDROID_AUDIO_MIME_TYPES = new Set([
  "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm", "audio/flac",
]);

function readAndroidAudioByteLength(value: unknown): number | null {
  try {
    if (value === null || typeof value !== "object" || !ArrayBuffer.isView(value)) return null;
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const tagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
    const lengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
    if (typeof tagGetter !== "function" || tagGetter.call(value) !== "Uint8Array" ||
        typeof lengthGetter !== "function") return null;
    const length = lengthGetter.call(value);
    return Number.isSafeInteger(length) && length >= 0 ? length : null;
  } catch {
    return null;
  }
}

function snapshotAndroidTranscriptionRequest(
  value: unknown,
  maxAudioBytes: number,
): SpeechToTextRequest | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    // Capture each request property once before validation or asynchronous work.
    const audio = source.audio;
    const consentValue = source.consent;
    const mimeType = source.mimeType;
    const language = source.language;
    const timestamps = source.timestamps;
    const signal = source.signal;

    const audioByteLength = readAndroidAudioByteLength(audio);
    if (audioByteLength === null || audioByteLength === 0 || audioByteLength > maxAudioBytes ||
        typeof mimeType !== "string" || !ANDROID_AUDIO_MIME_TYPES.has(mimeType) ||
        (language !== undefined &&
          (typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language))) ||
        (timestamps !== undefined && typeof timestamps !== "boolean") ||
        (signal !== undefined && (signal === null || typeof signal !== "object" ||
          typeof (signal as AbortSignal).aborted !== "boolean")) ||
        consentValue === null || typeof consentValue !== "object" ||
        Array.isArray(consentValue)) {
      return null;
    }

    const consent = consentValue as Record<string, unknown>;
    const granted = consent.granted;
    const purpose = consent.purpose;
    const sourceAction = consent.source;
    if (granted !== true || purpose !== "transcription" ||
        sourceAction !== "explicit_user_action") {
      return null;
    }

    const audioCopy = new Uint8Array(audioByteLength);
    Uint8Array.prototype.set.call(audioCopy, audio as Uint8Array);
    return {
      audio: audioCopy,
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: mimeType as SpeechToTextRequest["mimeType"],
      ...(language !== undefined ? { language: language as string } : {}),
      ...(timestamps !== undefined ? { timestamps: timestamps as boolean } : {}),
      ...(signal !== undefined ? { signal: signal as AbortSignal } : {}),
    };
  } catch {
    // Accessors and proxies supplied by callers are untrusted input.
    return null;
  }
}
