import { describe, expect, it } from "vitest";
import {
  createAndroidWhisperCppAdapter,
  type AndroidWhisperCppBridge,
} from "../src/core/android-whisper-bridge";
import type { DeviceCapabilityRequirements } from "../src/core/device-capabilities";
import type { SpeechToTextRequest, SpeechToTextResult } from "../src/core/speech-to-text";

const MODEL_SHA256 = "a".repeat(64);

const request: SpeechToTextRequest = {
  audio: new Uint8Array([1, 2, 3]),
  consent: { granted: true, purpose: "transcription", source: "explicit_user_action" },
  mimeType: "audio/wav",
  language: "pt-BR",
};

const result: SpeechToTextResult = {
  text: "Olá",
  language: "pt",
  segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
  engine: "whisper.cpp",
  modelId: "ggml-tiny",
};

const deviceRequirements = {
  runtime: "android_embedded" as const,
  minimumRamMb: 1024,
  minimumAvailableRamMb: 512,
  minimumCpuCores: 2,
  minimumAndroidApiLevel: 26,
};

function bridge(overrides: Partial<AndroidWhisperCppBridge> = {}): AndroidWhisperCppBridge {
  return {
    getStatus: async () => ({
      nativeLibraryReady: true,
      modelLoaded: true,
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      engineVersion: "test",
    }),
    transcribe: async () => result,
    ...overrides,
  };
}

describe("Android Whisper.cpp bridge contract", () => {
  it("creates an Android adapter without loading native code", () => {
    const adapter = createAndroidWhisperCppAdapter(bridge(), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    expect(adapter.runtime).toBe("android_embedded");
    expect(adapter.engine).toBe("whisper.cpp");
  });

  it("freezes adapter metadata and prevents replacing its transcriber", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge(), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    const originalTranscribe = adapter.transcribe;

    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Reflect.set(adapter, "modelId", "replacement-model")).toBe(false);
    expect(Reflect.set(adapter, "transcribe", async () => {
      throw new Error("replacement_transcriber_must_not_run");
    })).toBe(false);
    expect(adapter.modelId).toBe("ggml-tiny");
    expect(adapter.transcribe).toBe(originalTranscribe);
    await expect(adapter.transcribe(request)).resolves.toEqual(result);
  });

  it("reads each native status accessor exactly once", async () => {
    const reads: Record<string, number> = {};
    const values = {
      nativeLibraryReady: true,
      modelLoaded: true,
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      engineVersion: "test",
    };
    const status = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        {
          enumerable: true,
          get() {
            reads[key] = (reads[key] ?? 0) + 1;
            return reads[key] === 1 ? value : undefined;
          },
        },
      ]),
    );
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => Object.defineProperties({}, status),
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).resolves.toEqual(result);
    expect(reads).toEqual({
      nativeLibraryReady: 1,
      modelLoaded: 1,
      modelId: 1,
      modelSha256: 1,
      engineVersion: 1,
    });
  });

  it("rejects malformed native bridge status before transcribing", async () => {
    const malformedStatuses = [
      null,
      undefined,
      "ready",
      42,
      [],
      Object.defineProperty({}, "nativeLibraryReady", {
        get() { throw new Error("status_getter_failed"); },
      }),
      { nativeLibraryReady: "yes", modelLoaded: true, modelId: "ggml-tiny", modelSha256: MODEL_SHA256 },
      { nativeLibraryReady: true, modelLoaded: "yes", modelId: "ggml-tiny", modelSha256: MODEL_SHA256 },
      { nativeLibraryReady: true, modelLoaded: true, modelId: "", modelSha256: MODEL_SHA256 },
      { nativeLibraryReady: true, modelLoaded: true, modelId: "ggml-tiny", modelSha256: "bad" },
      { nativeLibraryReady: true, modelLoaded: true, modelId: "ggml-tiny", modelSha256: MODEL_SHA256, engineVersion: "x".repeat(129) },
      { nativeLibraryReady: false, modelLoaded: true, modelId: "ggml-tiny", modelSha256: MODEL_SHA256 },
    ];

    for (const malformedStatus of malformedStatuses) {
      let transcribeCalled = false;
      const adapter = createAndroidWhisperCppAdapter(bridge({
        getStatus: async () => malformedStatus as never,
        transcribe: async () => {
          transcribeCalled = true;
          return result;
        },
      }), {
        modelId: "ggml-tiny",
        modelSha256: MODEL_SHA256,
        maxAudioBytes: 1024,
        deviceRequirements,
      });
      await expect(adapter.transcribe(request))
        .rejects.toThrow("android_whisper_invalid_status");
      expect(transcribeCalled).toBe(false);
    }
  });

  it("fails closed when the native library is unavailable", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({ nativeLibraryReady: false, modelLoaded: false }),
    }), { modelId: "ggml-tiny", modelSha256: MODEL_SHA256, maxAudioBytes: 1024, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("android_whisper_native_library_unavailable");
  });

  it("fails closed when the requested model is not loaded", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true, modelLoaded: false, modelId: "ggml-tiny",
        modelSha256: MODEL_SHA256,
      }),
    }), { modelId: "ggml-tiny", modelSha256: MODEL_SHA256, maxAudioBytes: 1024, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("android_whisper_model_unavailable");
  });


  it("fails closed when the loaded model digest is missing or different", async () => {
    const missingDigest = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true,
        modelLoaded: true,
        modelId: "ggml-tiny",
      }),
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    await expect(missingDigest.transcribe(request))
      .rejects.toThrow("android_whisper_model_unavailable");

    const wrongDigest = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true,
        modelLoaded: true,
        modelId: "ggml-tiny",
        modelSha256: "b".repeat(64),
      }),
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    await expect(wrongDigest.transcribe(request))
      .rejects.toThrow("android_whisper_model_unavailable");
  });

  it("checks audio size before calling the bridge", async () => {
    let called = false;
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => {
        called = true;
        return { nativeLibraryReady: true, modelLoaded: true, modelId: "ggml-tiny" };
      },
    }), { modelId: "ggml-tiny", modelSha256: MODEL_SHA256, maxAudioBytes: 2, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("invalid_speech_to_text_request");
    expect(called).toBe(false);
  });

  it("rejects results for a different model or malformed segments", async () => {
    const wrongModel = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({ ...result, modelId: "another-model" }),
    }), { modelId: "ggml-tiny", modelSha256: MODEL_SHA256, maxAudioBytes: 1024, deviceRequirements });
    await expect(wrongModel.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");

    const invalidSegment = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({
        ...result, segments: [{ startMs: 500, endMs: 100, text: "bad" }],
      }),
    }), { modelId: "ggml-tiny", modelSha256: MODEL_SHA256, maxAudioBytes: 1024, deviceRequirements });
    await expect(invalidSegment.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");
  });

  it("keeps the approved native bridge methods after adapter creation", async () => {
    let statusCalls = 0;
    let transcribeCalls = 0;
    const sourceBridge = bridge({
      getStatus: async () => {
        statusCalls += 1;
        return {
          nativeLibraryReady: true,
          modelLoaded: true,
          modelId: "ggml-tiny",
          modelSha256: MODEL_SHA256,
          engineVersion: "original",
        };
      },
      transcribe: async () => {
        transcribeCalls += 1;
        return result;
      },
    });
    const adapter = createAndroidWhisperCppAdapter(sourceBridge, {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    sourceBridge.getStatus = async () => {
      throw new Error("replacement_status_must_not_run");
    };
    sourceBridge.transcribe = async () => {
      throw new Error("replacement_transcriber_must_not_run");
    };

    await expect(adapter.transcribe(request)).resolves.toEqual(result);
    expect(statusCalls).toBe(1);
    expect(transcribeCalls).toBe(1);
  });

  it("snapshots model, audio limit, and hardware requirements", async () => {
    const mutableRequirements: DeviceCapabilityRequirements = {
      runtime: "android_embedded",
      minimumRamMb: 1024,
      architectures: ["arm64" as const],
      platforms: ["android" as const],
    };
    const mutableOptions = {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 3,
      deviceRequirements: mutableRequirements,
    };
    const adapter = createAndroidWhisperCppAdapter(bridge(), mutableOptions);

    mutableOptions.modelId = "replacement-model";
    mutableOptions.maxAudioBytes = 1;
    mutableRequirements.minimumRamMb = 8192;
    mutableRequirements.architectures![0] = "x86";
    mutableRequirements.platforms![0] = "linux";

    expect(adapter.modelId).toBe("ggml-tiny");
    expect(adapter.deviceRequirements.minimumRamMb).toBe(1024);
    expect(adapter.deviceRequirements.architectures).toEqual(["arm64"]);
    expect(adapter.deviceRequirements.platforms).toEqual(["android"]);
    expect(Object.isFrozen(adapter.deviceRequirements)).toBe(true);
    expect(Object.isFrozen(adapter.deviceRequirements.architectures)).toBe(true);
    expect(Object.isFrozen(adapter.deviceRequirements.platforms)).toBe(true);
    await expect(adapter.transcribe(request)).resolves.toEqual(result);
  });

  it("rejects oversized or inconsistent native transcription results", async () => {
    const invalidResults: SpeechToTextResult[] = [
      { ...result, text: "x".repeat(100_001) },
      { ...result, language: "PT-br" },
      { ...result, segments: Array.from({ length: 5_001 }, () => ({ startMs: 0, endMs: 1, text: "x" })) },
      { ...result, segments: [{ startMs: 0, endMs: 1, text: "x".repeat(10_001) }] },
      { ...result, durationMs: 100, segments: [{ startMs: 0, endMs: 101, text: "late" }] },
    ];

    for (const invalidResult of invalidResults) {
      const adapter = createAndroidWhisperCppAdapter(bridge({
        transcribe: async () => invalidResult,
      }), {
        modelId: "ggml-tiny",
        modelSha256: MODEL_SHA256,
        maxAudioBytes: 1024,
        deviceRequirements,
      });
      await expect(adapter.transcribe(request))
        .rejects.toThrow("invalid_android_whisper_result");
    }
  });

  it("isolates and clears the native audio buffer after success", async () => {
    let nativeBuffer: Uint8Array | undefined;
    const originalAudio = request.audio.slice();
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async (nativeRequest) => {
        nativeBuffer = nativeRequest.audio;
        expect(nativeRequest.audio).not.toBe(request.audio);
        expect([...nativeRequest.audio]).toEqual([...originalAudio]);
        return result;
      },
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).resolves.toEqual(result);
    expect([...request.audio]).toEqual([...originalAudio]);
    expect(nativeBuffer && [...nativeBuffer]).toEqual([0, 0, 0]);
  });

  it("clears the native audio buffer when the bridge rejects", async () => {
    let nativeBuffer: Uint8Array | undefined;
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async (nativeRequest) => {
        nativeBuffer = nativeRequest.audio;
        throw new Error("native_transcription_failed");
      },
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).rejects.toThrow("native_transcription_failed");
    expect(nativeBuffer && [...nativeBuffer]).toEqual([0, 0, 0]);
    expect([...request.audio]).toEqual([1, 2, 3]);
  });

  it("returns a detached immutable snapshot of the native transcription", async () => {
    const nativeResult: SpeechToTextResult = {
      ...result,
      segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
    };
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => nativeResult,
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    const output = await adapter.transcribe(request);
    nativeResult.text = "alterado";
    nativeResult.segments[0].text = "alterado";
    nativeResult.segments[0].endMs = 999;

    expect(output.text).toBe("Olá");
    expect(output.segments[0]).toEqual({ startMs: 0, endMs: 500, text: "Olá" });
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.segments)).toBe(true);
    expect(Object.isFrozen(output.segments[0])).toBe(true);
    expect(Reflect.set(output, "text", "substituído")).toBe(false);
    expect(Reflect.set(output.segments[0], "text", "substituído")).toBe(false);
  });

  it("returns a valid transcription from a ready native bridge", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge(), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    await expect(adapter.transcribe(request)).resolves.toEqual(result);
  });

  it("rejects malformed adapter, bridge, and transcription request inputs", async () => {
    const validOptions = {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    };
    for (const invalidOptions of [null, undefined, 1, "options"]) {
      expect(() => createAndroidWhisperCppAdapter(
        bridge(),
        invalidOptions as never,
      )).toThrow("invalid_android_whisper_options");
    }
    for (const invalidBridge of [
      null,
      undefined,
      {},
      { getStatus: "not-a-function", transcribe: async () => result },
      { getStatus: async () => ({}), transcribe: null },
    ]) {
      expect(() => createAndroidWhisperCppAdapter(
        invalidBridge as never,
        validOptions,
      )).toThrow("invalid_android_whisper_options");
    }

    const adapter = createAndroidWhisperCppAdapter(bridge(), validOptions);
    for (const invalidRequest of [null, undefined, 1, "audio", {}]) {
      await expect(adapter.transcribe(invalidRequest as never))
        .rejects.toThrow("invalid_speech_to_text_request");
    }
  });

  it("rejects invalid adapter configuration and malformed model digests", () => {
    expect(() => createAndroidWhisperCppAdapter(bridge(), {
      modelId: " ", modelSha256: MODEL_SHA256, maxAudioBytes: 1024,
      deviceRequirements,
    })).toThrow("invalid_android_whisper_options");

    for (const modelSha256 of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)]) {
      expect(() => createAndroidWhisperCppAdapter(bridge(), {
        modelId: "ggml-tiny",
        modelSha256,
        maxAudioBytes: 1024,
        deviceRequirements,
      })).toThrow("invalid_android_whisper_options");
    }
  });
});
