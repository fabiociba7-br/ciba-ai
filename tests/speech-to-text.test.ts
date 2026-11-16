import { describe, expect, it } from "vitest";
import {
  createWhisperCppRegistry,
  validateSpeechToTextRequest,
  resolveWhisperCppRuntime,
  snapshotSpeechToTextResult,
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

  it("validates supported runtime policy values and rejects duplicates", () => {
    expect(() => createWhisperCppRegistry({
      ...policy,
      supportedRuntimes: ["unknown_runtime" as never],
    })).toThrow("invalid_speech_to_text_policy");
    expect(() => createWhisperCppRegistry({
      ...policy,
      supportedRuntimes: ["android_embedded", "android_embedded"],
    })).toThrow("invalid_speech_to_text_policy");
  });

  it("snapshots policy limits and supported runtimes at registry creation", () => {
    const mutablePolicy: SpeechToTextEnginePolicy = {
      ...policy,
      licenseStatus: "approved",
      supportedRuntimes: ["android_embedded"],
      maxAudioBytes: 1024,
      maxConcurrentTranscriptions: 2,
    };
    const registry = createWhisperCppRegistry(mutablePolicy, [adapter]);
    mutablePolicy.supportedRuntimes.splice(0, 1, "desktop_local");
    mutablePolicy.maxAudioBytes = 1;
    mutablePolicy.maxConcurrentTranscriptions = 1;

    expect(registry.maxAudioBytes).toBe(1024);
    expect(registry.listAvailableRuntimes()).toEqual(["android_embedded"]);
    const releaseOne = registry.tryAcquireExecution();
    const releaseTwo = registry.tryAcquireExecution();
    expect(releaseOne).toBeTypeOf("function");
    expect(releaseTwo).toBeTypeOf("function");
    expect(registry.tryAcquireExecution()).toBeUndefined();
    releaseOne?.();
    releaseTwo?.();
  });

  it("fails closed for null, malformed, or accessor-backed registry configuration", () => {
    expect(() => createWhisperCppRegistry(null as never)).toThrow("invalid_speech_to_text_policy");
    const throwingPolicy = Object.defineProperty({}, "supportedRuntimes", {
      get() { throw new Error("untrusted_policy_getter"); },
    });
    expect(() => createWhisperCppRegistry(throwingPolicy as never))
      .toThrow("invalid_speech_to_text_policy");
    const throwingAdapter = Object.defineProperty({}, "engine", {
      get() { throw new Error("untrusted_adapter_getter"); },
    });
    expect(() => createWhisperCppRegistry({
      ...policy, licenseStatus: "approved",
    }, [throwingAdapter as never])).toThrow("invalid_whisper_cpp_adapter");
  });

  it("copies hardware requirement lists without invoking caller iterators", () => {
    const architectures = new Proxy(["arm64"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("iterator_must_not_run");
        return Reflect.get(target, property, receiver);
      },
    });
    const sourceAdapter: SpeechToTextAdapter = {
      ...adapter,
      deviceRequirements: {
        ...adapter.deviceRequirements,
        architectures,
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy, licenseStatus: "approved",
    }, [sourceAdapter]);
    expect(registry.getAdapter("android_embedded")?.deviceRequirements.architectures)
      .toEqual(["arm64"]);
    expect(Object.isFrozen(registry.getAdapter("android_embedded")?.deviceRequirements.architectures))
      .toBe(true);
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

  it("keeps the registered adapter inventory isolated from source and returned arrays", () => {
    const sourceAdapters: SpeechToTextAdapter[] = [adapter];
    const registry = createWhisperCppRegistry({
      ...policy,
      licenseStatus: "approved",
    }, sourceAdapters);

    sourceAdapters.length = 0;
    sourceAdapters.push({
      ...adapter,
      runtime: "desktop_local",
      modelId: "replacement-model",
      deviceRequirements: {
        ...adapter.deviceRequirements,
        runtime: "desktop_local",
      },
    });

    const firstListing = registry.listAvailableRuntimes();
    expect(firstListing).toEqual(["android_embedded"]);
    firstListing.push("desktop_local");
    firstListing.splice(0, 1);

    expect(registry.listAvailableRuntimes()).toEqual(["android_embedded"]);
    expect(registry.getAdapter("android_embedded")?.modelId).toBe("ggml-tiny");
    expect(registry.getAdapter("desktop_local")).toBeUndefined();
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

describe("Whisper.cpp adapter result boundary", () => {
  it("captures accessor-backed output once and returns a detached immutable snapshot", () => {
    const reads: Record<string, number> = {};
    const counted = (key: string, value: unknown) => ({
      get() {
        reads[key] = (reads[key] ?? 0) + 1;
        return value;
      },
    });
    const segment = Object.defineProperties({}, {
      startMs: counted("startMs", 0),
      endMs: counted("endMs", 500),
      text: counted("segmentText", "Olá"),
    });
    const segments = new Proxy([segment], {
      get(target, property, receiver) {
        if (property === "length" || property === "0") {
          const key = String(property);
          reads[key] = (reads[key] ?? 0) + 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const source = Object.defineProperties({}, {
      engine: counted("engine", "whisper.cpp"),
      modelId: counted("modelId", "ggml-tiny"),
      text: counted("text", "Olá"),
      language: counted("language", "pt"),
      segments: counted("segments", segments),
      durationMs: counted("durationMs", 500),
    });

    const snapshot = snapshotSpeechToTextResult(source, "ggml-tiny");
    expect(snapshot).toEqual({
      engine: "whisper.cpp",
      modelId: "ggml-tiny",
      text: "Olá",
      language: "pt",
      durationMs: 500,
      segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
    });
    expect(reads).toEqual({
      engine: 1, modelId: 1, text: 1, language: 1,
      segments: 1, durationMs: 1, "0": 1, length: 1,
      startMs: 1, endMs: 1, segmentText: 1,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.segments)).toBe(true);
    expect(Object.isFrozen(snapshot?.segments[0])).toBe(true);
    expect(Reflect.set(snapshot!, "text", "alterado")).toBe(false);
  });

  it("fails closed for throwing getters, malformed segments, and oversized output", () => {
    const throwing = Object.defineProperty({}, "engine", {
      get() { throw new Error("untrusted_getter"); },
    });
    expect(snapshotSpeechToTextResult(throwing, "ggml-tiny")).toBeNull();

    const invalidSegment = {
      engine: "whisper.cpp",
      modelId: "ggml-tiny",
      text: "Olá",
      language: "pt",
      segments: [{ startMs: 10, endMs: 5, text: "inválido" }],
    };
    expect(snapshotSpeechToTextResult(invalidSegment, "ggml-tiny")).toBeNull();
    expect(snapshotSpeechToTextResult({
      engine: "whisper.cpp",
      modelId: "ggml-tiny",
      text: "x".repeat(100_001),
      language: "pt",
      segments: [],
    }, "ggml-tiny")).toBeNull();
  });

  it("does not invoke a caller-provided segments iterator", () => {
    const segments = new Proxy([{ startMs: 0, endMs: 1, text: "x" }], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator_must_not_run");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(snapshotSpeechToTextResult({
      engine: "whisper.cpp",
      modelId: "ggml-tiny",
      text: "x",
      language: "pt",
      segments,
    }, "ggml-tiny")?.segments).toEqual([{ startMs: 0, endMs: 1, text: "x" }]);
  });
});

