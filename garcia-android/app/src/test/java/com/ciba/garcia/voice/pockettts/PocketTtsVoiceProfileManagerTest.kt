package com.ciba.garcia.voice.pockettts

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PocketTtsVoiceProfileManagerTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test
    fun importPersistsDisplayNameAndDeleteRemovesAudioAndMetadata() {
        val root = temporaryFolder.newFolder("profiles")
        val manager = PocketTtsVoiceProfileManager(root)
        val imported = manager.importWav("  Voz de teste  ", ByteArrayInputStream(validWav()))

        val listed = manager.listProfiles()
        assertEquals(1, listed.size)
        assertEquals("Voz de teste", listed.single().displayName)
        assertEquals(imported.id, listed.single().id)
        assertTrue(File(root, "${imported.id}.json").isFile)

        assertTrue(manager.deleteProfile(imported.id))
        assertTrue(manager.listProfiles().isEmpty())
        assertFalse(imported.file.exists())
        assertFalse(File(root, "${imported.id}.json").exists())
    }

    @Test
    fun importRejectsWrongSampleRate() {
        val manager = PocketTtsVoiceProfileManager(temporaryFolder.newFolder("wrong-rate"))
        val invalid = validWav(sampleRate = 16_000)
        val error = runCatching {
            manager.importWav("Invalida", ByteArrayInputStream(invalid))
        }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
    }

    @Test
    fun importRejectsTruncatedRiff() {
        val manager = PocketTtsVoiceProfileManager(temporaryFolder.newFolder("truncated"))
        val truncated = validWav().copyOf().also { it[4] = 0x7f }
        val error = runCatching {
            manager.importWav("Truncada", ByteArrayInputStream(truncated))
        }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
    }

    private fun validWav(sampleRate: Int = 24_000): ByteArray {
        val samples = sampleRate * 3
        val dataSize = samples * 2
        val bytes = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        bytes.put("RIFF".toByteArray(Charsets.US_ASCII))
        bytes.putInt(36 + dataSize)
        bytes.put("WAVE".toByteArray(Charsets.US_ASCII))
        bytes.put("fmt ".toByteArray(Charsets.US_ASCII))
        bytes.putInt(16)
        bytes.putShort(1)
        bytes.putShort(1)
        bytes.putInt(sampleRate)
        bytes.putInt(sampleRate * 2)
        bytes.putShort(2)
        bytes.putShort(16)
        bytes.put("data".toByteArray(Charsets.US_ASCII))
        bytes.putInt(dataSize)
        repeat(samples) { bytes.putShort(0) }
        return bytes.array()
    }
}
