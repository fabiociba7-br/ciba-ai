export type SpeechToTextRuntime = "android_embedded" | "desktop_local" | "local_service";

export interface SpeechToTextRequest {
  audio: Uint8Array;
  mimeType: "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/webm" | "audio/flac";
  language?: string;
  timestamps?: boolean;
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
}

export interface SpeechToTextRegistry {
  getAdapter(runtime: SpeechToTextRuntime): SpeechToTextAdapter | undefined;
  listAvailableRuntimes(): SpeechToTextRuntime[];
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
      !Array.isArray(policy.supportedRuntimes) || policy.supportedRuntimes.length === 0) {
    throw new Error("invalid_speech_to_text_policy");
  }
  if (policy.licenseStatus !== "approved" && adapters.length > 0) {
    throw new Error("speech_to_text_license_not_approved");
  }

  const adapterMap = new Map<SpeechToTextRuntime, SpeechToTextAdapter>();
  for (const adapter of adapters) {
    if (adapter.engine !== "whisper.cpp" ||
        !policy.supportedRuntimes.includes(adapter.runtime) ||
        !adapter.modelId.trim() || adapterMap.has(adapter.runtime)) {
      throw new Error("invalid_whisper_cpp_adapter");
    }
    adapterMap.set(adapter.runtime, adapter);
  }

  return {
    getAdapter: (runtime) => adapterMap.get(runtime),
    listAvailableRuntimes: () => [...adapterMap.keys()],
  };
}

export function validateSpeechToTextRequest(
  request: SpeechToTextRequest,
  maxAudioBytes = 25 * 1024 * 1024,
): void {
  if (!(request.audio instanceof Uint8Array) || request.audio.byteLength === 0 ||
      request.audio.byteLength > maxAudioBytes ||
      !MIME_TYPES.has(request.mimeType) ||
      (request.language !== undefined && !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(request.language))) {
    throw new Error("invalid_speech_to_text_request");
  }
}
