import { describe, expect, it } from "vitest";
import {
  createWhisperCppRegistry,
  validateSpeechToTextRequest,
  type SpeechToTextAdapter,
  type SpeechToTextEnginePolicy,
} from "../src/core/speech-to-text";

const policy: SpeechToTextEnginePolicy = {
  licenseStatus: "review_required",
  supportedRuntimes: ["android_embedded", "desktop_local", "local_service"],
  maxAudioBytes: 1024,
};

const adapter: SpeechToTextAdapter = {
  engine: "whisper.cpp",
  runtime: "android_embedded",
  modelId: "ggml-tiny",
  transcribe: async () => ({
    text: "Olá",
    language: "pt",
    segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
    engine: "whisper.cpp",
    modelId: "ggml-tiny",
  }),
};

describe("Garcia Whisper.cpp integration contract", () => {
  it("does not expose an engine before an adapter is installed", () => {
    const registry = createWhisperCppRegistry(policy);
    expect(registry.listAvailableRuntimes()).toEqual([]);
    expect(registry.getAdapter("android_embedded")).toBeUndefined();
  });

  it("blocks adapter registration until license review is approved", () => {
    expect(() => createWhisperCppRegistry(policy, [adapter]))
      .toThrow("speech_to_text_license_not_approved");
  });

  it("registers only explicitly approved adapters on supported runtimes", () => {
    const registry = createWhisperCppRegistry({
      ...policy,
      licenseStatus: "approved",
    }, [adapter]);
    expect(registry.getAdapter("android_embedded")).toBe(adapter);
    expect(registry.listAvailableRuntimes()).toEqual(["android_embedded"]);
    expect(registry.getAdapter("remote_service" as never)).toBeUndefined();
  });

  it("rejects unsupported runtimes and duplicate adapters", () => {
    const approved = { ...policy, licenseStatus: "approved" as const };
    expect(() => createWhisperCppRegistry(approved, [{
      ...adapter,
      runtime: "remote_service" as never,
    }])).toThrow("invalid_whisper_cpp_adapter");
    expect(() => createWhisperCppRegistry(approved, [adapter, adapter]))
      .toThrow("invalid_whisper_cpp_adapter");
  });

  it("validates audio payload, format, size, and language without processing audio", () => {
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav",
      language: "pt-BR",
    })).not.toThrow();
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array(),
      mimeType: "audio/wav",
    })).toThrow("invalid_speech_to_text_request");
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array([1]),
      mimeType: "audio/wav",
      language: "portuguese",
    })).toThrow("invalid_speech_to_text_request");
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array(1025),
      mimeType: "audio/wav",
    }, 1024)).toThrow("invalid_speech_to_text_request");
  });
});
