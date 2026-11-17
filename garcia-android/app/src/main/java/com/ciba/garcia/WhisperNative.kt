package com.ciba.garcia

/**
 * Low-level JNI boundary for the bundled whisper.cpp engine.
 *
 * Callers must verify the selected model's SHA-256 before loading it, run
 * inference off the UI thread, and call release() when the engine is no longer
 * needed. This class never downloads models or accesses the network.
 */
internal object WhisperNative {
    init {
        System.loadLibrary("garcia_whisper")
    }

    external fun nativeLoadModel(modelPath: String): Boolean
    external fun nativeTranscribe(
        audioSamples16KhzMono: FloatArray,
        language: String = "pt",
        threads: Int
    ): String
    external fun nativeCancel()
    external fun nativeRelease()
    external fun nativeIsModelLoaded(): Boolean
    external fun nativeEngineVersion(): String
}
