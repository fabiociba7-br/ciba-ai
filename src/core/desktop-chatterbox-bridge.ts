import {
  validateDeviceCapabilityRequirements,
  type DeviceCapabilityRequirements,
} from "./device-capabilities";
import type {
  TextToSpeechAdapter,
  TextToSpeechRequest,
  TextToSpeechResult,
} from "./text-to-speech";

/**
 * Implemented by the Garcia desktop host. The bridge must call an embedded
 * local runtime directly; network, HTTP, sockets and remote inference are
 * explicitly outside this contract.
 */
export interface DesktopChatterboxBridgeStatus {
  runtimeReady: boolean;
  modelLoaded: boolean;
  modelId?: string;
  modelSha256?: string;
  engineVersion?: string;
}

export interface DesktopChatterboxBridge {
  getStatus(): Promise<DesktopChatterboxBridgeStatus>;
  synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult>;
}

export interface DesktopChatterboxAdapterOptions {
  modelId: string;
  modelSha256: string;
  licenseStatus: "review_required" | "approved" | "restricted" | "rejected";
  deviceRequirements: DeviceCapabilityRequirements;
}

const SHA256 = /^[a-f0-9]{64}$/;
const MODEL_ID_MAX = 200;

function snapshotStatus(value: unknown): DesktopChatterboxBridgeStatus | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const runtimeReady = source.runtimeReady;
    const modelLoaded = source.modelLoaded;
    const modelId = source.modelId;
    const modelSha256 = source.modelSha256;
    const engineVersion = source.engineVersion;
    if (typeof runtimeReady !== "boolean" || typeof modelLoaded !== "boolean" ||
        (modelId !== undefined &&
          (typeof modelId !== "string" || modelId.length < 1 || modelId.length > MODEL_ID_MAX)) ||
        (modelSha256 !== undefined &&
          (typeof modelSha256 !== "string" || !SHA256.test(modelSha256))) ||
        (engineVersion !== undefined &&
          (typeof engineVersion !== "string" || engineVersion.length > 128)) ||
        (modelLoaded && (!runtimeReady || typeof modelId !== "string" ||
          typeof modelSha256 !== "string"))) return null;
    return Object.freeze({
      runtimeReady,
      modelLoaded,
      ...(modelId !== undefined ? { modelId } : {}),
      ...(modelSha256 !== undefined ? { modelSha256 } : {}),
      ...(engineVersion !== undefined ? { engineVersion } : {}),
    });
  } catch {
    return null;
  }
}

function snapshotResult(value: unknown, modelId: string): TextToSpeechResult | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const audio = source.audio;
    const mimeType = source.mimeType;
    const sampleRateHz = source.sampleRateHz;
    const durationMs = source.durationMs;
    const engine = source.engine;
    const resultModelId = source.modelId;
    const language = source.language;
    if (!(audio instanceof Uint8Array) || Object.getPrototypeOf(audio) !== Uint8Array.prototype ||
        audio.byteLength < 44 || audio.byteLength > 25 * 1024 * 1024 ||
        mimeType !== "audio/wav" || engine !== "chatterbox" ||
        resultModelId !== modelId || !Number.isInteger(sampleRateHz) ||
        (sampleRateHz as number) < 8000 || (sampleRateHz as number) > 192000 ||
        typeof durationMs !== "number" || !Number.isFinite(durationMs) ||
        durationMs <= 0 || durationMs > 30 * 60 * 1000 ||
        typeof language !== "string" || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language)) {
      return null;
    }
    // Copy across the host boundary so later mutation cannot alter returned audio.
    return Object.freeze({
      audio: new Uint8Array(audio),
      mimeType: "audio/wav",
      sampleRateHz: sampleRateHz as number,
      durationMs,
      engine: "chatterbox",
      modelId,
      language,
    });
  } catch {
    return null;
  }
}

/**
 * Creates a desktop-only adapter around a host-provided embedded runtime.
 * Model licensing is fail-closed: no adapter is created before approval.
 */
export function createDesktopChatterboxAdapter(
  bridge: DesktopChatterboxBridge,
  options: DesktopChatterboxAdapterOptions,
): TextToSpeechAdapter {
  if (!bridge || typeof bridge !== "object" ||
      typeof bridge.getStatus !== "function" ||
      typeof bridge.synthesize !== "function" ||
      !options || typeof options !== "object" ||
      typeof options.modelId !== "string" || !options.modelId.trim() ||
      options.modelId.length > MODEL_ID_MAX ||
      typeof options.modelSha256 !== "string" || !SHA256.test(options.modelSha256) ||
      options.licenseStatus !== "approved" ||
      !options.deviceRequirements || options.deviceRequirements.runtime !== "desktop_local") {
    throw new Error(options?.licenseStatus === "approved"
      ? "invalid_desktop_chatterbox_options"
      : "chatterbox_model_license_not_approved");
  }
  validateDeviceCapabilityRequirements(options.deviceRequirements);

  const modelId = options.modelId;
  const modelSha256 = options.modelSha256;
  const deviceRequirements = Object.freeze({ ...options.deviceRequirements });
  const getStatus = bridge.getStatus.bind(bridge);
  const synthesize = bridge.synthesize.bind(bridge);

  return Object.freeze({
    engine: "chatterbox" as const,
    runtime: "desktop_local" as const,
    modelId,
    deviceRequirements,
    async synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult> {
      if (request.signal?.aborted) throw new Error("text_to_speech_aborted");
      const status = snapshotStatus(await getStatus());
      if (!status) throw new Error("desktop_chatterbox_invalid_status");
      if (!status.runtimeReady) throw new Error("desktop_chatterbox_runtime_unavailable");
      if (!status.modelLoaded || status.modelId !== modelId ||
          status.modelSha256 !== modelSha256) {
        throw new Error("desktop_chatterbox_model_unavailable");
      }
      const result = snapshotResult(await synthesize(request), modelId);
      if (!result) throw new Error("invalid_desktop_chatterbox_result");
      if (request.signal?.aborted) {
        result.audio.fill(0);
        throw new Error("text_to_speech_aborted");
      }
      return result;
    },
  });
}
