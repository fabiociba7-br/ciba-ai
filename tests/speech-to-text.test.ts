import { describe, expect, it } from "vitest";
import {
  createWhisperCppRegistry,
  validateSpeechToTextRequest,
  resolveWhisperCppRuntime,
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
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: "audio/wav",
      language: "pt-BR",
    })).not.toThrow();
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array(),
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: "audio/wav",
    })).toThrow("invalid_speech_to_text_request");
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array([1]),
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: "audio/wav",
      language: "portuguese",
    })).toThrow("invalid_speech_to_text_request");
    expect(() => validateSpeechToTextRequest({
      audio: new Uint8Array(1025),
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: "audio/wav",
    }, 1024)).toThrow("invalid_speech_to_text_request");
  });
  it("requires both a compatible device and an installed adapter before offering transcription", () => {
    const profile = {
      platform: "android" as const, architecture: "arm64" as const,
      totalRamMb: 4096, availableRamMb: 2048, logicalCpuCores: 8,
      gpuAvailable: false, androidApiLevel: 35, collectedAt: 1794800000000,
      source: "client_report" as const,
    };
    const requirements = { runtime: "android_embedded" as const, minimumRamMb: 1024, minimumCpuCores: 4 };
    const emptyRegistry = createWhisperCppRegistry({ ...policy, licenseStatus: "approved" });
    expect(resolveWhisperCppRuntime(emptyRegistry, profile, requirements))
      .toEqual({ available: false, reasons: ["adapter_not_installed"] });
    const readyRegistry = createWhisperCppRegistry({ ...policy, licenseStatus: "approved" }, [adapter]);
    expect(resolveWhisperCppRuntime(readyRegistry, profile, requirements))
      .toMatchObject({ available: true, reasons: [], adapter });
  });

  it("does not offer transcription on an incompatible device even if an adapter exists", () => {
    const profile = {
      platform: "android" as const, architecture: "arm64" as const,
      totalRamMb: 512, availableRamMb: 128, logicalCpuCores: 2,
      gpuAvailable: false, androidApiLevel: 23, collectedAt: 1794800000000,
      source: "client_report" as const,
    };
    const readyRegistry = createWhisperCppRegistry({ ...policy, licenseStatus: "approved" }, [adapter]);
    expect(resolveWhisperCppRuntime(readyRegistry, profile, {
      runtime: "android_embedded", minimumRamMb: 1024, minimumAvailableRamMb: 512,
      minimumCpuCores: 4, minimumAndroidApiLevel: 26,
    })).toEqual({ available: false, reasons: [
      "insufficient_total_ram", "insufficient_available_ram", "insufficient_cpu_cores", "android_api_too_low",
    ] });
  });

});
