import { describe, expect, it } from "vitest";
import {
  createAndroidWhisperCppAdapter,
  type AndroidWhisperCppBridge,
} from "../src/core/android-whisper-bridge";
import type { DeviceCapabilityRequirements } from "../src/core/device-capabilities";
import type { SpeechToTextRequest, SpeechToTextResult } from "../src/core/speech-to-text";

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
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    expect(adapter.runtime).toBe("android_embedded");
    expect(adapter.engine).toBe("whisper.cpp");
  });

  it("fails closed when the native library is unavailable", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({ nativeLibraryReady: false, modelLoaded: false }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("android_whisper_native_library_unavailable");
  });

  it("fails closed when the requested model is not loaded", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true, modelLoaded: false, modelId: "ggml-tiny",
      }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("android_whisper_model_unavailable");
  });

  it("checks audio size before calling the bridge", async () => {
    let called = false;
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => {
        called = true;
        return { nativeLibraryReady: true, modelLoaded: true, modelId: "ggml-tiny" };
      },
    }), { modelId: "ggml-tiny", maxAudioBytes: 2, deviceRequirements });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("invalid_speech_to_text_request");
    expect(called).toBe(false);
  });

  it("rejects results for a different model or malformed segments", async () => {
    const wrongModel = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({ ...result, modelId: "another-model" }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024, deviceRequirements });
    await expect(wrongModel.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");

    const invalidSegment = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({
        ...result, segments: [{ startMs: 500, endMs: 100, text: "bad" }],
      }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024, deviceRequirements });
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

  it("returns a valid transcription from a ready native bridge", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge(), {
      modelId: "ggml-tiny",
      maxAudioBytes: 1024,
      deviceRequirements,
    });
    await expect(adapter.transcribe(request)).resolves.toEqual(result);
  });

  it("rejects invalid adapter configuration", () => {
    expect(() => createAndroidWhisperCppAdapter(bridge(), {
      modelId: " ", maxAudioBytes: 1024,
      deviceRequirements,
    })).toThrow("invalid_android_whisper_options");
  });
});
