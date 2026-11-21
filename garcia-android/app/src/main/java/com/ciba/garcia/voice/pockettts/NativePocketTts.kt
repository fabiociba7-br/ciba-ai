package com.ciba.garcia.voice.pockettts

/**
 * JNI wrapper for the Pocket TTS runtime embedded directly in Garcia.
 * Coordinates active native calls so close() never frees a handle still in use.
 */
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
    private var handle: Long = 0L
    private var activeSyntheses = 0
    private var closed = false

    init {
        require(modelsDir.isNotBlank() && voicesDir.isNotBlank())
        require(temperature.isFinite() && temperature in 0.0f..2.0f)
        require(lsdSteps in 1..8 && threads in 1..8)
        System.loadLibrary("pockettts_jni")
        handle = nativeCreate(modelsDir, voicesDir, precision, temperature, lsdSteps,
            threads, sentencePauseMs.coerceIn(0, 2000), maxTextTokens.coerceIn(10, 200))
        check(handle != 0L) { "Não foi possível carregar o modelo Pocket TTS." }
    }

    fun synthesize(text: String, voiceFile: String, sink: AudioSink): Boolean {
        require(text.isNotBlank() && voiceFile.isNotBlank())
        val current = synchronized(this) {
            check(!closed && handle != 0L) { "O motor Pocket TTS já foi encerrado." }
            activeSyntheses++
            handle
        }
        return try {
            nativeSynthesize(current, text, voiceFile, sink)
        } finally {
            synchronized(this) {
                activeSyntheses--
                (this as java.lang.Object).notifyAll()
            }
        }
    }

    /** May be called from another thread while native synthesis is blocked on a stream read. */
    fun stop() {
        val current = synchronized(this) {
            if (closed) 0L else handle
        }
        if (current != 0L) nativeStop(current)
    }

    override fun close() {
        val current: Long
        synchronized(this) {
            if (closed) return
            closed = true
            current = handle
            if (current == 0L) return
        }

        // Wake a blocked native read; wait for synthesize() to release its handle.
        nativeStop(current)
        var interrupted = false
        synchronized(this) {
            while (activeSyntheses > 0) {
                try {
                    (this as java.lang.Object).wait()
                } catch (_: InterruptedException) {
                    interrupted = true
                }
            }
            handle = 0L
        }
        nativeDestroy(current)
        if (interrupted) Thread.currentThread().interrupt()
    }

    fun interface AudioSink { fun onAudio(samples: FloatArray): Boolean }

    private external fun nativeCreate(modelsDir: String, voicesDir: String, precision: String,
        temperature: Float, lsdSteps: Int, threads: Int, sentencePauseMs: Int, maxTextTokens: Int): Long
    private external fun nativeSynthesize(handle: Long, text: String, voiceFile: String, sink: AudioSink): Boolean
    private external fun nativeStop(handle: Long)
    private external fun nativeDestroy(handle: Long)
}
