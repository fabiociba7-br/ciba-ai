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
  deviceRequirements: {
    runtime: "android_embedded",
    minimumRamMb: 1024,
    minimumAvailableRamMb: 512,
    minimumCpuCores: 2,
    minimumAndroidApiLevel: 26,
  },
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

  it("freezes the public registry surface and preserves its validated audio limit", () => {
    const registry = createWhisperCppRegistry({
      ...policy,
      licenseStatus: "approved",
    }, [adapter]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Reflect.set(registry, "maxAudioBytes", 1)).toBe(false);
    expect(Reflect.set(registry, "getAdapter", () => undefined)).toBe(false);
    expect(Reflect.set(registry, "tryAcquireExecution", () => undefined)).toBe(false);
    expect(registry.maxAudioBytes).toBe(1024);
    expect(registry.getAdapter("android_embedded")?.modelId).toBe("ggml-tiny");
  });

  it("registers only explicitly approved adapters on supported runtimes", () => {
    const registry = createWhisperCppRegistry({
      ...policy,
      licenseStatus: "approved",
    }, [adapter]);
    expect(registry.getAdapter("android_embedded")).toMatchObject({
      engine: adapter.engine,
      runtime: adapter.runtime,
      modelId: adapter.modelId,
      deviceRequirements: adapter.deviceRequirements,
    });
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
      .toMatchObject({
        available: true,
        reasons: [],
        adapter: {
          engine: adapter.engine,
          runtime: adapter.runtime,
          modelId: adapter.modelId,
          deviceRequirements: adapter.deviceRequirements,
        },
      });
  });

  it("snapshots and freezes adapter hardware requirements at registration", () => {
    const mutableRequirements = { ...adapter.deviceRequirements };
    const sourceAdapter = { ...adapter, deviceRequirements: mutableRequirements };
    const registry = createWhisperCppRegistry({
      ...policy, licenseStatus: "approved",
    }, [sourceAdapter]);
    mutableRequirements.minimumRamMb = 16384;
    const registered = registry.getAdapter("android_embedded");
    expect(registered?.deviceRequirements.minimumRamMb).toBe(1024);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.deviceRequirements)).toBe(true);
  });

  it("keeps the approved transcriber implementation after registration", async () => {
    let originalCalls = 0;
    const sourceAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        originalCalls += 1;
        return {
          text: "Original",
          language: "pt",
          segments: [],
          engine: "whisper.cpp",
          modelId: "ggml-tiny",
        };
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy, licenseStatus: "approved",
    }, [sourceAdapter]);
    sourceAdapter.transcribe = async () => {
      throw new Error("replacement_transcriber_must_not_run");
    };

    const registered = registry.getAdapter("android_embedded");
    expect(registered).toBeDefined();
    const result = await registered!.transcribe({
      audio: new Uint8Array([1]),
      consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
      mimeType: "audio/wav",
    });
    expect(result.text).toBe("Original");
    expect(originalCalls).toBe(1);
  });

  it("enforces the selected model hardware floor in addition to runtime requirements", () => {
    const profile = {
      platform: "android" as const, architecture: "arm64" as const,
      totalRamMb: 4096, availableRamMb: 256, logicalCpuCores: 8,
      gpuAvailable: false, androidApiLevel: 35, collectedAt: 1794800000000,
      source: "client_report" as const,
    };
    const readyRegistry = createWhisperCppRegistry({ ...policy, licenseStatus: "approved" }, [adapter]);
    expect(resolveWhisperCppRuntime(readyRegistry, profile, {
      runtime: "android_embedded", minimumRamMb: 1024,
    })).toEqual({ available: false, reasons: ["insufficient_available_ram"] });
  });

  it("rejects model requirements declared for a different runtime", () => {
    const approved = { ...policy, licenseStatus: "approved" as const };
    expect(() => createWhisperCppRegistry(approved, [{
      ...adapter,
      deviceRequirements: { ...adapter.deviceRequirements, runtime: "desktop_local" },
    }])).toThrow("invalid_whisper_cpp_adapter");
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
