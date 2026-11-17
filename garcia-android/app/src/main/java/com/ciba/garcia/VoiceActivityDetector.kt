package com.ciba.garcia

/**
 * Detects speech boundaries from PCM16 microphone frames without retaining audio.
 *
 * The pre-roll remains in the recorder buffer so the first phoneme is not lost;
 * this detector only decides when a turn has ended.
 */
internal class VoiceActivityDetector(
    private val sampleRate: Int = 16_000,
    private val speechRmsThreshold: Double = 0.018,
    private val minimumPeakThreshold: Int = 450,
    private val trailingSilenceMillis: Long = 1_100,
    private val noSpeechTimeoutMillis: Long = 10_000,
    private val maximumTurnMillis: Long = 120_000
) {
    private var startedAtMillis: Long? = null
    private var lastSpeechAtMillis: Long? = null
    private var speechObserved = false

    fun shouldStop(frame: ShortArray, offset: Int, length: Int, nowMillis: Long): StopReason? {
        require(offset >= 0 && length > 0 && offset + length <= frame.size) {
            "Quadro PCM inválido."
        }
        val started = startedAtMillis ?: nowMillis.also { startedAtMillis = it }
        if (nowMillis - started >= maximumTurnMillis) return StopReason.MAX_DURATION

        var sumSquares = 0.0
        var peak = 0
        for (index in offset until offset + length) {
            val sample = frame[index].toInt()
            val magnitude = kotlin.math.abs(sample)
            if (magnitude > peak) peak = magnitude
            sumSquares += sample.toDouble() * sample.toDouble()
        }
        val rms = kotlin.math.sqrt(sumSquares / length) / Short.MAX_VALUE
        val speechFrame = rms >= speechRmsThreshold && peak >= minimumPeakThreshold
        if (speechFrame) {
            speechObserved = true
            lastSpeechAtMillis = nowMillis
            return null
        }

        if (!speechObserved && nowMillis - started >= noSpeechTimeoutMillis) {
            return StopReason.NO_SPEECH
        }
        val lastSpeech = lastSpeechAtMillis
        if (speechObserved && lastSpeech != null && nowMillis - lastSpeech >= trailingSilenceMillis) {
            return StopReason.SILENCE
        }
        return null
    }

    enum class StopReason { SILENCE, NO_SPEECH, MAX_DURATION }
}
