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
      getStatus: async () => Object.defineProperties(
        { ...values },
        status,
      ) as Awaited<ReturnType<AndroidWhisperCppBridge["getStatus"]>>,
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

  it("snapshots each Android transcription request field exactly once", async () => {
    const reads: Record<string, number> = {};
    const consent = Object.defineProperties({}, {
      granted: { enumerable: true, get() { reads.granted = (reads.granted ?? 0) + 1; return true; } },
      purpose: { enumerable: true, get() { reads.purpose = (reads.purpose ?? 0) + 1; return "transcription"; } },
      source: { enumerable: true, get() { reads.source = (reads.source ?? 0) + 1; return "explicit_user_action"; } },
    });
    const requestWithGetters = Object.defineProperties({}, {
      audio: { enumerable: true, get() { reads.audio = (reads.audio ?? 0) + 1; return request.audio; } },
      consent: { enumerable: true, get() { reads.consent = (reads.consent ?? 0) + 1; return consent; } },
      mimeType: { enumerable: true, get() { reads.mimeType = (reads.mimeType ?? 0) + 1; return "audio/wav"; } },
      language: { enumerable: true, get() { reads.language = (reads.language ?? 0) + 1; return "pt-BR"; } },
      timestamps: { enumerable: true, get() { reads.timestamps = (reads.timestamps ?? 0) + 1; return true; } },
    });
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async (nativeRequest) => {
        expect(nativeRequest.audio).not.toBe(request.audio);
        expect(nativeRequest.mimeType).toBe("audio/wav");
        expect(nativeRequest.language).toBe("pt-BR");
        expect(nativeRequest.timestamps).toBe(true);
        return result;
      },
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(requestWithGetters as SpeechToTextRequest)).resolves.toEqual(result);
    expect(reads).toEqual({
      audio: 1, consent: 1, mimeType: 1, language: 1, timestamps: 1,
      granted: 1, purpose: 1, source: 1,
    });
  });

  it("rejects malformed Android requests before reading native status", async () => {
    let statusCalled = false;
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => {
        statusCalled = true;
        return {
          nativeLibraryReady: true, modelLoaded: true, modelId: "ggml-tiny",
          modelSha256: MODEL_SHA256,
        };
      },
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    const malformedRequests = [
      null,
      undefined,
      Object.defineProperty({}, "audio", {
        get() { throw new Error("request_audio_getter_failed"); },
      }),
      { ...request, mimeType: "application/octet-stream" },
      { ...request, consent: { granted: false, purpose: "transcription", source: "explicit_user_action" } },
      { ...request, language: "INVALID" },
    ];

    for (const malformed of malformedRequests) {
      await expect(adapter.transcribe(malformed as SpeechToTextRequest))
        .rejects.toThrow("invalid_speech_to_text_request");
    }
    expect(statusCalled).toBe(false);
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

  it("reads each native result and segment accessor exactly once", async () => {
    const resultReads: Record<string, number> = {};
    const segmentReads: Record<string, number> = {};
    const nativeSegment = Object.defineProperties({}, {
      startMs: { enumerable: true, get() { segmentReads.startMs = (segmentReads.startMs ?? 0) + 1; return 0; } },
      endMs: { enumerable: true, get() { segmentReads.endMs = (segmentReads.endMs ?? 0) + 1; return 500; } },
      text: { enumerable: true, get() { segmentReads.text = (segmentReads.text ?? 0) + 1; return "Olá"; } },
    });
    const nativeResult = Object.defineProperties({}, {
      engine: { enumerable: true, get() { resultReads.engine = (resultReads.engine ?? 0) + 1; return "whisper.cpp"; } },
      modelId: { enumerable: true, get() { resultReads.modelId = (resultReads.modelId ?? 0) + 1; return "ggml-tiny"; } },
      text: { enumerable: true, get() { resultReads.text = (resultReads.text ?? 0) + 1; return "Olá"; } },
      language: { enumerable: true, get() { resultReads.language = (resultReads.language ?? 0) + 1; return "pt"; } },
      segments: { enumerable: true, get() { resultReads.segments = (resultReads.segments ?? 0) + 1; return [nativeSegment]; } },
      durationMs: { enumerable: true, get() { resultReads.durationMs = (resultReads.durationMs ?? 0) + 1; return 500; } },
    });
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => nativeResult as SpeechToTextResult,
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).resolves.toEqual({ ...result, durationMs: 500 });
    expect(resultReads).toEqual({
      engine: 1, modelId: 1, text: 1, language: 1, segments: 1, durationMs: 1,
    });
    expect(segmentReads).toEqual({ startMs: 1, endMs: 1, text: 1 });
  });

  it("reads proxied native segment length and entries exactly once", async () => {
    const reads = { length: 0, first: 0 };
    const nativeSegments = new Proxy(
      [{ startMs: 0, endMs: 500, text: "Olá" }],
      {
        get(target, property, receiver) {
          if (property === "length") {
            reads.length += 1;
            return reads.length === 1 ? 1 : 0;
          }
          if (property === "0") {
            reads.first += 1;
            return reads.first === 1 ? target[0] : undefined;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({ ...result, segments: nativeSegments }) as SpeechToTextResult,
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).resolves.toMatchObject({
      segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
    });
    expect(reads).toEqual({ length: 1, first: 1 });
  });

  it("does not invoke a native segments iterator", async () => {
    const nativeSegments = [{ startMs: 0, endMs: 500, text: "Olá" }];
    Object.defineProperty(nativeSegments, Symbol.iterator, {
      get() { throw new Error("native_segments_iterator_must_not_run"); },
    });
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({ ...result, segments: nativeSegments }) as SpeechToTextResult,
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(request)).resolves.toMatchObject({
      text: "Olá",
      segments: [{ startMs: 0, endMs: 500, text: "Olá" }],
    });
  });

  it("rejects native transcription results with throwing getters", async () => {
    const malformedResult = Object.defineProperty({}, "text", {
      enumerable: true,
      get() { throw new Error("native_result_getter_failed"); },
    });
    const adapter = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => malformedResult as SpeechToTextResult,
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");
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

  it("clears the isolated audio copy when native status validation fails", async () => {
    let isolatedAudio: Uint8Array | undefined;
    class TrackedAudio extends Uint8Array {
      override slice(): Uint8Array {
        isolatedAudio = new Uint8Array(this);
        return isolatedAudio;
      }
    }
    const trackedRequest = {
      ...request,
      audio: new TrackedAudio([1, 2, 3]),
    };
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => {
        throw new Error("native_status_unavailable");
      },
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(trackedRequest))
      .rejects.toThrow("native_status_unavailable");
    expect(isolatedAudio && [...isolatedAudio]).toEqual([0, 0, 0]);
    expect([...trackedRequest.audio]).toEqual([1, 2, 3]);
  });

  it("clears the isolated audio copy when the native model is unavailable", async () => {
    let isolatedAudio: Uint8Array | undefined;
    class TrackedAudio extends Uint8Array {
      override slice(): Uint8Array {
        isolatedAudio = new Uint8Array(this);
        return isolatedAudio;
      }
    }
    const trackedRequest = {
      ...request,
      audio: new TrackedAudio([1, 2, 3]),
    };
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true,
        modelLoaded: false,
        modelId: "ggml-tiny",
        modelSha256: MODEL_SHA256,
      }),
    }), {
      modelId: "ggml-tiny",
      modelSha256: MODEL_SHA256,
      maxAudioBytes: 1024,
      deviceRequirements,
    });

    await expect(adapter.transcribe(trackedRequest))
      .rejects.toThrow("android_whisper_model_unavailable");
    expect(isolatedAudio && [...isolatedAudio]).toEqual([0, 0, 0]);
    expect([...trackedRequest.audio]).toEqual([1, 2, 3]);
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
