import { describe, expect, it } from "vitest";
import {
  createWhisperCppRegistry,
  runWhisperCppTranscription,
  type SpeechToTextAdapter,
  type SpeechToTextEnginePolicy,
  type SpeechToTextRequest,
} from "../src/core/speech-to-text";

const policy: SpeechToTextEnginePolicy = {
  licenseStatus: "approved",
  supportedRuntimes: ["android_embedded"],
  maxAudioBytes: 1024,
};

const profile = {
  platform: "android" as const,
  architecture: "arm64" as const,
  totalRamMb: 4096,
  availableRamMb: 2048,
  logicalCpuCores: 8,
  gpuAvailable: false,
  androidApiLevel: 35,
  collectedAt: 1794800000000,
  source: "client_report" as const,
};

const requirements = {
  runtime: "android_embedded" as const,
  minimumRamMb: 1024,
  minimumAvailableRamMb: 512,
  minimumCpuCores: 4,
  minimumAndroidApiLevel: 26,
};

const request: SpeechToTextRequest = {
  audio: new Uint8Array([1, 2, 3]),
  consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
  mimeType: "audio/wav" as const,
  language: "pt-BR",
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

describe("guarded Whisper.cpp transcription execution", () => {
  it("returns a clear unavailable result when no adapter is registered", async () => {
    const registry = createWhisperCppRegistry(policy);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).resolves.toEqual({ success: false, reasons: ["adapter_not_installed"] });
  });

  it("executes through the registered adapter after validation and compatibility checks", async () => {
    const registry = createWhisperCppRegistry(policy, [adapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).resolves.toEqual({
      success: true,
      result: {
        text: "Olá",
        language: "pt",
        segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
        engine: "whisper.cpp",
        modelId: "ggml-tiny",
      },
    });
  });

  it("rejects concurrent work beyond the registry capacity and releases the slot afterward", async () => {
    let finish: (() => void) | undefined;
    let calls = 0;
    const slowAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        calls += 1;
        await new Promise<void>((resolve) => { finish = resolve; });
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy,
      maxConcurrentTranscriptions: 1,
    }, [slowAdapter]);
    const first = runWhisperCppTranscription(registry, profile, requirements, request);
    await Promise.resolve();
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).resolves.toEqual({
      success: false,
      reasons: ["transcription_capacity_reached"],
    });
    expect(calls).toBe(1);
    finish?.();
    await expect(first).resolves.toMatchObject({ success: true });
    const second = runWhisperCppTranscription(
      registry, profile, requirements, request,
    );
    await Promise.resolve();
    finish?.();
    await expect(second).resolves.toMatchObject({ success: true });
    expect(calls).toBe(2);
  });

  it("releases the concurrency slot when the adapter fails", async () => {
    let shouldFail = true;
    let calls = 0;
    const recoverableAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        calls += 1;
        if (shouldFail) throw new Error("temporary_engine_failure");
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy,
      maxConcurrentTranscriptions: 1,
    }, [recoverableAdapter]);

    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("temporary_engine_failure");

    shouldFail = false;
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).resolves.toMatchObject({ success: true });
    expect(calls).toBe(2);
  });

  it("does not start a transcription when its signal is already aborted", async () => {
    let called = false;
    const controller = new AbortController();
    controller.abort();
    const countingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        called = true;
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry(policy, [countingAdapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, { ...request, signal: controller.signal },
    )).resolves.toEqual({
      success: false,
      reasons: ["transcription_cancelled"],
    });
    expect(called).toBe(false);
  });

  it("forwards cancellation to the adapter and releases capacity after it settles", async () => {
    const controller = new AbortController();
    let adapterSignal: AbortSignal | undefined;
    let adapterAudio: Uint8Array | undefined;
    const cancellableAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async (input) => {
        adapterSignal = input.signal;
        adapterAudio = input.audio;
        return new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(new Error("adapter_cancelled")),
            { once: true },
          );
        });
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy,
      maxConcurrentTranscriptions: 1,
    }, [cancellableAdapter]);
    const execution = runWhisperCppTranscription(
      registry, profile, requirements, { ...request, signal: controller.signal },
    );
    await Promise.resolve();
    expect(adapterSignal).toBe(controller.signal);
    controller.abort();
    await expect(execution).rejects.toThrow("adapter_cancelled");
    expect(adapterAudio && [...adapterAudio]).toEqual([0, 0, 0]);

    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).resolves.toMatchObject({
      success: false,
      reasons: ["adapter_not_installed"],
    });
  });

  it("clears the temporary audio copy after successful transcription without mutating caller audio", async () => {
    const original = new Uint8Array([7, 8, 9]);
    let adapterAudio: Uint8Array | undefined;
    const observingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async (input) => {
        adapterAudio = input.audio;
        expect(input.audio).not.toBe(original);
        expect([...input.audio]).toEqual([7, 8, 9]);
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry(policy, [observingAdapter]);
    await runWhisperCppTranscription(
      registry, profile, requirements, { ...request, audio: original },
    );
    expect([...original]).toEqual([7, 8, 9]);
    expect(adapterAudio && [...adapterAudio]).toEqual([0, 0, 0]);
  });

  it("clears the temporary audio copy when the adapter rejects", async () => {
    let adapterAudio: Uint8Array | undefined;
    const rejectingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async (input) => {
        adapterAudio = input.audio;
        throw new Error("engine_failed");
      },
    };
    const registry = createWhisperCppRegistry(policy, [rejectingAdapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("engine_failed");
    expect(adapterAudio && [...adapterAudio]).toEqual([0, 0, 0]);
  });

  it("clears the temporary audio copy when the adapter returns an invalid result", async () => {
    let adapterAudio: Uint8Array | undefined;
    const invalidResultAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async (input) => {
        adapterAudio = input.audio;
        return {
          text: "invalid",
          language: "pt",
          segments: [{ startMs: 100, endMs: 50, text: "invalid" }],
          engine: "whisper.cpp",
          modelId: "ggml-tiny",
        };
      },
    };
    const registry = createWhisperCppRegistry(policy, [invalidResultAdapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("invalid_whisper_cpp_result");
    expect(adapterAudio && [...adapterAudio]).toEqual([0, 0, 0]);
  });

  it("rejects invalid audio before invoking the adapter", async () => {
    let called = false;
    const countingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        called = true;
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry(policy, [countingAdapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, { ...request, audio: new Uint8Array() },
    )).rejects.toThrow("invalid_speech_to_text_request");
    expect(called).toBe(false);
  });

  it("does not invoke an adapter on incompatible hardware", async () => {
    let called = false;
    const countingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        called = true;
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry(policy, [countingAdapter]);
    const lowMemoryProfile = { ...profile, totalRamMb: 512, availableRamMb: 128 };
    await expect(runWhisperCppTranscription(
      registry, lowMemoryProfile, requirements, request,
    )).resolves.toMatchObject({
      success: false,
      reasons: ["insufficient_total_ram", "insufficient_available_ram"],
    });
    expect(called).toBe(false);
  });

  it("rejects oversized or inconsistent transcription output", async () => {
    const oversized: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => ({
        text: "x".repeat(100_001),
        language: "pt",
        segments: [],
        engine: "whisper.cpp",
        modelId: "ggml-tiny",
      }),
    };
    const registry = createWhisperCppRegistry(policy, [oversized]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("invalid_whisper_cpp_result");

    const inconsistent: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => ({
        text: "Olá",
        language: "pt",
        durationMs: 100,
        segments: [{ startMs: 0, endMs: 101, text: "Olá" }],
        engine: "whisper.cpp",
        modelId: "ggml-tiny",
      }),
    };
    const inconsistentRegistry = createWhisperCppRegistry(policy, [inconsistent]);
    await expect(runWhisperCppTranscription(
      inconsistentRegistry, profile, requirements, request,
    )).rejects.toThrow("invalid_whisper_cpp_result");
  });

  it("rejects malformed results from an adapter", async () => {
    const malformed: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => ({
        text: "bad",
        language: "pt",
        segments: [{ startMs: 500, endMs: 100, text: "bad" }],
        engine: "whisper.cpp" as const,
        modelId: "ggml-tiny",
      }),
    };
    const registry = createWhisperCppRegistry(policy, [malformed]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("invalid_whisper_cpp_result");
  });

  it("enforces the audio byte limit configured in the registry", async () => {
    let called = false;
    const countingAdapter: SpeechToTextAdapter = {
      ...adapter,
      transcribe: async () => {
        called = true;
        return adapter.transcribe(request);
      },
    };
    const registry = createWhisperCppRegistry({
      ...policy,
      maxAudioBytes: 2,
    }, [countingAdapter]);

    await expect(runWhisperCppTranscription(
      registry, profile, requirements, request,
    )).rejects.toThrow("invalid_speech_to_text_request");
    expect(called).toBe(false);
  });

  it("rejects audio larger than the execution limit", async () => {
    const registry = createWhisperCppRegistry(policy, [adapter]);
    await expect(runWhisperCppTranscription(
      registry, profile, requirements,
      { ...request, audio: new Uint8Array(1025) },
      1024,
    )).rejects.toThrow("invalid_speech_to_text_request");
  });
});
