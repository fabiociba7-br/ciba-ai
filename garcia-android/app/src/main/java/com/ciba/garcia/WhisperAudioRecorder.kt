package com.ciba.garcia

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock

/**
 * Captures microphone audio locally as mono PCM16 at 16 kHz.
 * Audio is held in memory only and is cleared after stop or cancellation.
 */
internal class WhisperAudioRecorder {
    private var recorder: AudioRecord? = null
    private var samples = ShortArray(0)
    private var sampleCount = 0
    private var recording = false
    private var startedAtMillis = 0L
    private val activityDetector = VoiceActivityDetector()
    var stopReason: VoiceActivityDetector.StopReason? = null
        private set

    @Synchronized
    fun start() {
        check(!recording) { "Já existe uma gravação em andamento." }
        val minimum = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        check(minimum > 0) { "O dispositivo não disponibilizou um microfone compatível." }
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minimum, SAMPLE_RATE / 2)
        )
        check(audioRecord.state == AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            "Não foi possível inicializar o microfone."
        }
        samples = ShortArray(SAMPLE_RATE * MAX_SECONDS)
        sampleCount = 0
        stopReason = null
        startedAtMillis = SystemClock.elapsedRealtime()
        recorder = audioRecord
        try {
            audioRecord.startRecording()
            recording = true
        } catch (error: Exception) {
            recorder = null
            audioRecord.release()
            samples.fill(0)
            samples = ShortArray(0)
            throw IllegalStateException("Não foi possível iniciar a captura do microfone.", error)
        }
    }

    @Synchronized
    fun readChunk(): Boolean {
        val active = recorder ?: return false
        if (!recording || sampleCount >= samples.size) return false
        val count = active.read(samples, sampleCount, minOf(FRAME_SAMPLES, samples.size - sampleCount))
        if (count < 0) {
            recording = false
            throw IllegalStateException("A captura de áudio foi interrompida pelo Android (código $count).")
        }
        if (count == 0) return recording
        val frameOffset = sampleCount
        sampleCount += count
        val reason = activityDetector.shouldStop(samples, frameOffset, count, SystemClock.elapsedRealtime())
        if (reason != null) {
            stopReason = reason
            recording = false
            return false
        }
        return recording && sampleCount < samples.size
    }

    @Synchronized
    fun stop(): FloatArray {
        val active = recorder
        recording = false
        recorder = null
        if (active != null) {
            runCatching { active.stop() }
            active.release()
        }
        val result = FloatArray(sampleCount) { index -> samples[index] / 32768.0f }
        samples.fill(0)
        samples = ShortArray(0)
        sampleCount = 0
        return result
    }

    @Synchronized
    fun cancel() {
        recording = false
        recorder?.let { active ->
            runCatching { active.stop() }
            active.release()
        }
        recorder = null
        samples.fill(0)
        samples = ShortArray(0)
        sampleCount = 0
        stopReason = null
    }

    companion object {
        const val SAMPLE_RATE = 16_000
        const val MAX_SECONDS = 120
        private const val FRAME_SAMPLES = 4_096
    }
}
