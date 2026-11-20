package com.ciba.garcia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceActivityDetectorTest {
    private val speechFrame = ShortArray(4_096) { 3_000 }
    private val silenceFrame = ShortArray(4_096)

    @Test
    fun speechEndsOnlyAfterTrailingSilence() {
        val detector = VoiceActivityDetector(trailingSilenceMillis = 1_000)
        assertNull(detector.shouldStop(speechFrame, 0, speechFrame.size, 0))
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 500))
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 900))
        assertEquals(
            VoiceActivityDetector.StopReason.SILENCE,
            detector.shouldStop(silenceFrame, 0, silenceFrame.size, 1_000)
        )
    }

    @Test
    fun defaultSilenceWindowDoesNotCutShortNaturalPauses() {
        val detector = VoiceActivityDetector()
        assertNull(detector.shouldStop(speechFrame, 0, speechFrame.size, 0))
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 700))
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 1_200))
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 1_399))
        assertEquals(
            VoiceActivityDetector.StopReason.SILENCE,
            detector.shouldStop(silenceFrame, 0, silenceFrame.size, 1_400)
        )
    }

    @Test
    fun silenceWithoutSpeechTimesOutInsteadOfSubmittingEmptyAudio() {
        val detector = VoiceActivityDetector(noSpeechTimeoutMillis = 2_000)
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 0))
        assertEquals(
            VoiceActivityDetector.StopReason.NO_SPEECH,
            detector.shouldStop(silenceFrame, 0, silenceFrame.size, 2_000)
        )
    }

    @Test
    fun maximumTurnDurationIsEnforcedEvenDuringSpeech() {
        val detector = VoiceActivityDetector(maximumTurnMillis = 3_000)
        assertNull(detector.shouldStop(speechFrame, 0, speechFrame.size, 0))
        assertEquals(
            VoiceActivityDetector.StopReason.MAX_DURATION,
            detector.shouldStop(speechFrame, 0, speechFrame.size, 3_000)
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidFrameBoundsAreRejected() {
        VoiceActivityDetector().shouldStop(speechFrame, 4_000, 200, 0)
    }

    @Test
    fun resetStartsANewIndependentTurn() {
        val detector = VoiceActivityDetector(noSpeechTimeoutMillis = 1_000)
        detector.shouldStop(speechFrame, 0, speechFrame.size, 0)
        detector.reset()
        assertNull(detector.shouldStop(silenceFrame, 0, silenceFrame.size, 2_000))
    }
}
