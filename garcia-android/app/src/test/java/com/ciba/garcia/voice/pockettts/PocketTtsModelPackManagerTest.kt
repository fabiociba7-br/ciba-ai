package com.ciba.garcia.voice.pockettts

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PocketTtsModelPackManagerTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test
    fun installsValidPackAndWritesIntegrityManifest() {
        val root = temporaryFolder.newFolder("packs")
        val manager = PocketTtsModelPackManager(root)

        val installed = manager.installPack(ByteArrayInputStream(validPackZip()))

        assertEquals("ptbr-basic", installed.id)
        assertEquals("Português Brasil", installed.name)
        assertEquals("pt-BR", installed.languageTag)
        assertEquals("fp32", installed.precision)
        assertTrue(File(installed.modelsDirectory, "mimi_encoder.onnx").isFile)
        assertTrue(File(installed.directory, "integrity.sha256").readText().contains("models/mimi_encoder.onnx"))
        assertEquals(1, manager.listInstalledPacks().size)
        assertTrue(manager.deletePack(installed.id))
        assertTrue(manager.listInstalledPacks().isEmpty())
    }

    @Test
    fun rejectsZipPathTraversalWithoutWritingOutsidePrivateRoot() {
        val root = temporaryFolder.newFolder("traversal-packs")
        val manager = PocketTtsModelPackManager(root)
        val outside = File(root.parentFile, "escape.txt")

        val error = runCatching {
            manager.installPack(ByteArrayInputStream(validPackZip("../escape.txt" to "escape")))
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
        assertFalse(outside.exists())
        assertTrue(root.listFiles().orEmpty().isEmpty())
    }

    @Test
    fun rejectsUnapprovedFilesAndDirectories() {
        val manager = PocketTtsModelPackManager(temporaryFolder.newFolder("unapproved"))

        val fileError = runCatching {
            manager.installPack(ByteArrayInputStream(validPackZip("payload.txt" to "not allowed")))
        }.exceptionOrNull()
        assertTrue(fileError is IllegalArgumentException)

        val directoryError = runCatching {
            manager.installPack(ByteArrayInputStream(validPackZip("private-cache/" to "")))
        }.exceptionOrNull()
        assertTrue(directoryError is IllegalArgumentException)
    }

    @Test
    fun rejectsPackWithMissingRequiredModelFiles() {
        val manager = PocketTtsModelPackManager(temporaryFolder.newFolder("incomplete"))

        val error = runCatching {
            manager.installPack(ByteArrayInputStream(validPackZip(includeModels = false)))
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
        assertTrue(manager.listInstalledPacks().isEmpty())
    }

    private fun validPackZip(
        vararg extraEntries: Pair<String, String>,
        includeModels: Boolean = true
    ): ByteArray {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            zip.addEntry("manifest.json", """{"id":"ptbr-basic","name":"Português Brasil","languageTag":"pt-BR","precision":"fp32"}""")
            if (includeModels) {
                listOf(
                    "mimi_encoder.onnx",
                    "text_conditioner.onnx",
                    "tokenizer.model",
                    "flow_lm_main.onnx",
                    "flow_lm_flow.onnx",
                    "mimi_decoder.onnx"
                ).forEach { zip.addEntry("models/$it", "model:$it") }
            }
            extraEntries.forEach { (name, value) -> zip.addEntry(name, value) }
        }
        return output.toByteArray()
    }

    private fun ZipOutputStream.addEntry(name: String, value: String) {
        putNextEntry(ZipEntry(name))
        write(value.toByteArray(Charsets.UTF_8))
        closeEntry()
    }
}
