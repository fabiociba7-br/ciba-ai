package com.ciba.garcia.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceEngineCatalogTest {
    @Test
    fun catalogContainsFourPlannedEngines() {
        assertEquals(
            setOf("pocket-tts", "neutts", "voxcpm2", "xtts-v2"),
            VoiceEngineCatalog.engines.map { it.id }.toSet()
        )
    }

    @Test
    fun localAndLabEnginesAreNotConfused() {
        assertEquals(EngineExecution.ON_DEVICE, VoiceEngineCatalog.find("pocket-tts")?.execution)
        assertEquals(EngineExecution.ON_DEVICE, VoiceEngineCatalog.find("neutts")?.execution)
        assertEquals(EngineExecution.REMOTE_LAB, VoiceEngineCatalog.find("voxcpm2")?.execution)
        assertEquals(EngineExecution.REMOTE_LAB, VoiceEngineCatalog.find("xtts-v2")?.execution)
    }

    @Test
    fun catalogDoesNotClaimUnvalidatedEnginesAreReady() {
        assertTrue(VoiceEngineCatalog.engines.none { it.maturity == EngineMaturity.PLANNED && it.id.isBlank() })
        assertEquals(EngineMaturity.EXPERIMENTAL, VoiceEngineCatalog.find("pocket-tts")?.maturity)
        assertEquals(EngineMaturity.LANGUAGE_LIMITED, VoiceEngineCatalog.find("neutts")?.maturity)
        assertNotNull(VoiceEngineCatalog.find("xtts-v2")?.licenseSummary)
    }
}
