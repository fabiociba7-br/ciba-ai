import { describe, expect, it } from "vitest";
import {
  createAndroidWhisperCppAdapter,
  type AndroidWhisperCppBridge,
} from "../src/core/android-whisper-bridge";
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
    });
    expect(adapter.runtime).toBe("android_embedded");
    expect(adapter.engine).toBe("whisper.cpp");
  });

  it("fails closed when the native library is unavailable", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({ nativeLibraryReady: false, modelLoaded: false }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024 });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("android_whisper_native_library_unavailable");
  });

  it("fails closed when the requested model is not loaded", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge({
      getStatus: async () => ({
        nativeLibraryReady: true, modelLoaded: false, modelId: "ggml-tiny",
      }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024 });
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
    }), { modelId: "ggml-tiny", maxAudioBytes: 2 });
    await expect(adapter.transcribe(request))
      .rejects.toThrow("invalid_speech_to_text_request");
    expect(called).toBe(false);
  });

  it("rejects results for a different model or malformed segments", async () => {
    const wrongModel = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({ ...result, modelId: "another-model" }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024 });
    await expect(wrongModel.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");

    const invalidSegment = createAndroidWhisperCppAdapter(bridge({
      transcribe: async () => ({
        ...result, segments: [{ startMs: 500, endMs: 100, text: "bad" }],
      }),
    }), { modelId: "ggml-tiny", maxAudioBytes: 1024 });
    await expect(invalidSegment.transcribe(request))
      .rejects.toThrow("invalid_android_whisper_result");
  });

  it("returns a valid transcription from a ready native bridge", async () => {
    const adapter = createAndroidWhisperCppAdapter(bridge(), {
      modelId: "ggml-tiny",
      maxAudioBytes: 1024,
    });
    await expect(adapter.transcribe(request)).resolves.toEqual(result);
  });

  it("rejects invalid adapter configuration", () => {
    expect(() => createAndroidWhisperCppAdapter(bridge(), {
      modelId: " ", maxAudioBytes: 1024,
    })).toThrow("invalid_android_whisper_options");
  });
});
