import type { DeviceCapabilityRequirements } from "./device-capabilities";

export type TextToSpeechRuntime = "desktop_local" | "android_embedded";

export interface TextToSpeechConsent {
  granted: true;
  purpose: "speech_synthesis";
  source: "explicit_user_action";
}

export interface TextToSpeechRequest {
  text: string;
  consent: TextToSpeechConsent;
  language: "pt-br" | "pt" | "en";
  voiceProfileId?: string;
  signal?: AbortSignal;
}

export interface TextToSpeechResult {
  audio: Uint8Array;
  mimeType: "audio/wav";
  sampleRateHz: number;
  durationMs: number;
  engine: "chatterbox";
  modelId: string;
  language: string;
}

export interface TextToSpeechAdapter {
  readonly engine: "chatterbox";
  readonly runtime: TextToSpeechRuntime;
  readonly modelId: string;
  readonly deviceRequirements: DeviceCapabilityRequirements;
  synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult>;
}

export interface TextToSpeechEnginePolicy {
  licenseStatus: "review_required" | "approved" | "restricted" | "rejected";
  supportedRuntimes: TextToSpeechRuntime[];
  maxTextChars: number;
  maxAudioBytes: number;
  maxConcurrentSynthesis?: number;
}

export interface TextToSpeechRegistry {
  readonly maxTextChars: number;
  readonly maxAudioBytes: number;
  getAdapter(runtime: TextToSpeechRuntime): TextToSpeechAdapter | undefined;
  listAvailableRuntimes(): TextToSpeechRuntime[];
  tryAcquireExecution(): (() => void) | undefined;
}

const VALID_RUNTIMES = new Set<TextToSpeechRuntime>(["desktop_local", "android_embedded"]);
const MAX_TEXT_CHARS = 12_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function ownData(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
        required.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function denseArray(value: unknown, max: number): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length === 0 || value.length > max) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = descriptors[String(i)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function copyAudio(value: unknown, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      value.byteLength < 1 || value.byteLength > maxBytes) {
    throw new Error("invalid_speech_audio");
  }
  return new Uint8Array(value);
}

export function validateTextToSpeechRequest(
  value: unknown,
  maxTextChars = MAX_TEXT_CHARS,
): TextToSpeechRequest {
  const fields = ownData(value, ["text", "consent", "language", "voiceProfileId", "signal"],
    ["text", "consent", "language"]);
  const consent = ownData(fields?.consent, ["granted", "purpose", "source"],
    ["granted", "purpose", "source"]);
  const text = fields?.text;
  const language = fields?.language;
  const voiceProfileId = fields?.voiceProfileId;
  if (!fields || !consent || typeof text !== "string" || !text.trim() ||
      text.length > maxTextChars ||
      consent.granted !== true || consent.purpose !== "speech_synthesis" ||
      consent.source !== "explicit_user_action" ||
      !["pt-br", "pt", "en"].includes(language as string) ||
      (voiceProfileId !== undefined &&
        (typeof voiceProfileId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(voiceProfileId)))) {
    throw new Error("invalid_text_to_speech_request");
  }
  return Object.freeze({
    text,
    consent: Object.freeze({ granted: true, purpose: "speech_synthesis", source: "explicit_user_action" }),
    language: language as TextToSpeechRequest["language"],
    ...(voiceProfileId === undefined ? {} : { voiceProfileId }),
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }),
  });
}

/**
 * Local-only Chatterbox registry. No network transport, model download, or
 * remote runtime is implemented here. Adapters are supplied by the host app.
 */
export function createChatterboxRegistry(
  policy: TextToSpeechEnginePolicy,
  adapters: TextToSpeechAdapter[] = [],
): TextToSpeechRegistry {
  const fields = ownData(policy, [
    "licenseStatus", "supportedRuntimes", "maxTextChars", "maxAudioBytes", "maxConcurrentSynthesis",
  ], ["licenseStatus", "supportedRuntimes", "maxTextChars", "maxAudioBytes"]);
  if (!fields) throw new Error("invalid_text_to_speech_policy");
  const runtimes = denseArray(fields.supportedRuntimes, 2);
  const maxTextChars = fields.maxTextChars;
  const maxAudioBytes = fields.maxAudioBytes;
  const maxConcurrent = fields.maxConcurrentSynthesis ?? 1;
  if (!runtimes || runtimes.some((runtime) => !VALID_RUNTIMES.has(runtime as TextToSpeechRuntime)) ||
      new Set(runtimes).size !== runtimes.length ||
      !Number.isInteger(maxTextChars) || (maxTextChars as number) < 1 ||
      (maxTextChars as number) > MAX_TEXT_CHARS ||
      !Number.isInteger(maxAudioBytes) || (maxAudioBytes as number) < 1 ||
      (maxAudioBytes as number) > MAX_AUDIO_BYTES ||
      !Number.isInteger(maxConcurrent) || (maxConcurrent as number) < 1 ||
      (maxConcurrent as number) > 4 ||
      !["review_required", "approved", "restricted", "rejected"].includes(fields.licenseStatus as string)) {
    throw new Error("invalid_text_to_speech_policy");
  }
  const safeAdapters = denseArray(adapters, 2);
  if (!safeAdapters) throw new Error("invalid_chatterbox_adapter");
  if (fields.licenseStatus !== "approved" && safeAdapters.length > 0) {
    throw new Error("text_to_speech_license_not_approved");
  }

  const adapterMap = new Map<TextToSpeechRuntime, TextToSpeechAdapter>();
  for (const candidate of safeAdapters) {
    const adapter = ownData(candidate, [
      "engine", "runtime", "modelId", "deviceRequirements", "synthesize",
    ], ["engine", "runtime", "modelId", "deviceRequirements", "synthesize"]);
    if (!adapter || adapter.engine !== "chatterbox" ||
        !VALID_RUNTIMES.has(adapter.runtime as TextToSpeechRuntime) ||
        !runtimes.includes(adapter.runtime) ||
        typeof adapter.modelId !== "string" || !adapter.modelId.trim() ||
        adapter.modelId.length > 200 || typeof adapter.synthesize !== "function" ||
        adapterMap.has(adapter.runtime as TextToSpeechRuntime)) {
      throw new Error("invalid_chatterbox_adapter");
    }
    const requirements = ownData(adapter.deviceRequirements, [
      "runtime", "minimumRamMb", "minimumAvailableRamMb", "minimumCpuCores",
      "requiresGpu", "architectures", "platforms", "minimumAndroidApiLevel",
    ], ["runtime", "minimumRamMb"]);
    if (!requirements || requirements.runtime !== adapter.runtime ||
        !Number.isInteger(requirements.minimumRamMb) ||
        (requirements.minimumRamMb as number) < 256 ||
        (requirements.minimumRamMb as number) > 262144) {
      throw new Error("invalid_chatterbox_adapter");
    }
    adapterMap.set(adapter.runtime as TextToSpeechRuntime, Object.freeze({
      engine: "chatterbox",
      runtime: adapter.runtime as TextToSpeechRuntime,
      modelId: adapter.modelId,
      deviceRequirements: Object.freeze({ ...requirements }) as unknown as DeviceCapabilityRequirements,
      synthesize: (adapter.synthesize as TextToSpeechAdapter["synthesize"]).bind(candidate),
    }));
  }

  let active = 0;
  return Object.freeze({
    maxTextChars: maxTextChars as number,
    maxAudioBytes: maxAudioBytes as number,
    getAdapter: (runtime: TextToSpeechRuntime) => adapterMap.get(runtime),
    listAvailableRuntimes: () => [...adapterMap.keys()],
    tryAcquireExecution: () => {
      if (active >= (maxConcurrent as number)) return undefined;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      };
    },
  });
}

export async function runChatterboxSynthesis(
  registry: TextToSpeechRegistry,
  runtime: TextToSpeechRuntime,
  request: unknown,
): Promise<TextToSpeechResult> {
  const registryFields = ownData(registry, [
    "maxTextChars", "maxAudioBytes", "getAdapter", "listAvailableRuntimes", "tryAcquireExecution",
  ], ["maxTextChars", "maxAudioBytes", "getAdapter", "listAvailableRuntimes", "tryAcquireExecution"]);
  if (!registryFields || !Number.isInteger(registryFields.maxTextChars) ||
      !Number.isInteger(registryFields.maxAudioBytes) ||
      typeof registryFields.getAdapter !== "function" ||
      typeof registryFields.tryAcquireExecution !== "function") {
    throw new Error("invalid_text_to_speech_registry");
  }
  const safeRequest = validateTextToSpeechRequest(request, registryFields.maxTextChars as number);
  if (safeRequest.signal?.aborted) throw new Error("text_to_speech_aborted");
  const acquire = registryFields.tryAcquireExecution as TextToSpeechRegistry["tryAcquireExecution"];
  const release = acquire();
  if (!release) throw new Error("text_to_speech_busy");
  try {
    const getAdapter = registryFields.getAdapter as TextToSpeechRegistry["getAdapter"];
    const adapter = getAdapter(runtime);
    if (!adapter) throw new Error("chatterbox_adapter_unavailable");
    const result = await adapter.synthesize(safeRequest);
    if (safeRequest.signal?.aborted) throw new Error("text_to_speech_aborted");
    const output = ownData(result, [
      "audio", "mimeType", "sampleRateHz", "durationMs", "engine", "modelId", "language",
    ], ["audio", "mimeType", "sampleRateHz", "durationMs", "engine", "modelId", "language"]);
    if (!output || output.engine !== "chatterbox" || output.mimeType !== "audio/wav" ||
        !Number.isInteger(output.sampleRateHz) || (output.sampleRateHz as number) < 8000 ||
        (output.sampleRateHz as number) > 192000 ||
        !Number.isFinite(output.durationMs) || (output.durationMs as number) <= 0 ||
        (output.durationMs as number) > 30 * 60 * 1000 ||
        typeof output.modelId !== "string" || output.modelId !== adapter.modelId ||
        typeof output.language !== "string" || output.language.length > 16) {
      throw new Error("invalid_text_to_speech_result");
    }
    return Object.freeze({
      audio: copyAudio(output.audio, registryFields.maxAudioBytes as number),
      mimeType: "audio/wav" as const,
      sampleRateHz: output.sampleRateHz as number,
      durationMs: output.durationMs as number,
      engine: "chatterbox" as const,
      modelId: output.modelId,
      language: output.language,
    });
  } finally {
    release();
  }
}
