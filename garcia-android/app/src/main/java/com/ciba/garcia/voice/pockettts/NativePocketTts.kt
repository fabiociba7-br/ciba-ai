package com.ciba.garcia.voice.pockettts

/** JNI wrapper for the Pocket TTS runtime embedded directly in Garcia. */
internal class NativePocketTts(
    modelsDir: String,
    voicesDir: String,
    precision: String = "fp32",
    temperature: Float = 0.5f,
    lsdSteps: Int = 1,
    threads: Int = 2,
    sentencePauseMs: Int = 250,
    maxTextTokens: Int = 50
) : AutoCloseable {
    @Volatile
    private var handle: Long = 0L

    init {
        require(modelsDir.isNotBlank() && voicesDir.isNotBlank())
        System.loadLibrary("pockettts_jni")
        handle = nativeCreate(modelsDir, voicesDir, precision, temperature, lsdSteps,
            threads, sentencePauseMs, maxTextTokens)
        check(handle != 0L) { "Não foi possível carregar o modelo Pocket TTS." }
    }

    fun synthesize(text: String, voiceFile: String, sink: AudioSink): Boolean {
        val current = handle
        check(current != 0L) { "O motor Pocket TTS já foi encerrado." }
        require(text.isNotBlank() && voiceFile.isNotBlank())
        return nativeSynthesize(current, text, voiceFile, sink)
    }

    fun stop() {
        val current = handle
        if (current != 0L) nativeStop(current)
    }

    @Synchronized
    override fun close() {
        val current = handle
        if (current != 0L) {
            handle = 0L
            nativeDestroy(current)
        }
    }

    fun interface AudioSink { fun onAudio(samples: FloatArray): Boolean }

    private external fun nativeCreate(modelsDir: String, voicesDir: String, precision: String,
        temperature: Float, lsdSteps: Int, threads: Int, sentencePauseMs: Int, maxTextTokens: Int): Long
    private external fun nativeSynthesize(handle: Long, text: String, voiceFile: String, sink: AudioSink): Boolean
    private external fun nativeStop(handle: Long)
    private external fun nativeDestroy(handle: Long)
}
