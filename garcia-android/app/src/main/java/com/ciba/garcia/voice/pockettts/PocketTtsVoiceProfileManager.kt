package com.ciba.garcia.voice.pockettts

import java.util.Properties
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/** Stores user-authorized speaker reference WAV files in Garcia's private app storage. */
internal class PocketTtsVoiceProfileManager(private val privateRoot: File) {
    data class VoiceProfile(
        val id: String,
        val displayName: String,
        val file: File,
        val durationSeconds: Float
    )

    fun importWav(displayName: String, input: InputStream): VoiceProfile {
        val safeName = displayName.trim()
            .filterNot { it.isISOControl() }
            .take(64)
            .ifBlank { "Minha voz" }
        if (!privateRoot.exists() && !privateRoot.mkdirs()) {
            throw IllegalStateException("Não foi possível criar o armazenamento privado das vozes.")
        }
        require(privateRoot.isDirectory) { "O armazenamento privado das vozes não é um diretório." }
        val bytes = input.use { readBounded(it, MAX_WAV_BYTES) }
        val duration = validatePcmWav(bytes)
        val id = UUID.randomUUID().toString()
        val root = privateRoot.canonicalFile
        val destination = File(root, "$id.wav")
        val metadata = File(root, "$id.properties")
        val temporary = File(root, ".$id.tmp")
        val temporaryMetadata = File(root, ".$id.properties.tmp")
        try {
            temporary.writeBytes(bytes)
            val profileMetadata = Properties().apply {
                setProperty("id", id)
                setProperty("displayName", safeName)
                setProperty("durationSeconds", duration.toString())
            }
            temporaryMetadata.outputStream().use { profileMetadata.store(it, "Garcia Pocket TTS voice profile") }
            if (!temporary.renameTo(destination)) {
                throw IllegalStateException("Não foi possível salvar o perfil de voz.")
            }
            if (!temporaryMetadata.renameTo(metadata)) {
                destination.delete()
                throw IllegalStateException("Não foi possível salvar os dados do perfil de voz.")
            }
            return VoiceProfile(id, safeName, destination, duration)
        } catch (error: Throwable) {
            temporary.delete()
            temporaryMetadata.delete()
            destination.delete()
            metadata.delete()
            throw error
        }
    }

    fun listProfiles(): List<VoiceProfile> {
        if (!privateRoot.isDirectory) return emptyList()
        return privateRoot.listFiles().orEmpty()
            .filter { it.isFile && it.name.matches(PROFILE_WAV_NAME) }
            .mapNotNull { file ->
                runCatching {
                    val duration = validatePcmWav(file.readBytes())
                    val id = file.nameWithoutExtension
                    val metadataFile = File(privateRoot, "$id.properties")
                    val displayName = if (metadataFile.isFile) {
                        Properties().apply { metadataFile.inputStream().use { load(it) } }
                            .takeIf { it.getProperty("id") == id }
                            ?.getProperty("displayName")
                            ?.takeIf { it.isNotBlank() }
                    } else null
                    VoiceProfile(id, displayName ?: id, file, duration)
                }.getOrNull()
            }
            .sortedBy { it.displayName.lowercase() }
    }

    fun deleteProfile(id: String): Boolean {
        require(id.matches(PROFILE_ID)) { "Identificador de voz inválido." }
        val root = privateRoot.canonicalFile
        val file = File(root, "$id.wav").canonicalFile
        val metadata = File(root, "$id.properties").canonicalFile
        require(file.parentFile == root && metadata.parentFile == root) { "Caminho de perfil inválido." }
        val audioDeleted = !file.exists() || file.delete()
        val metadataDeleted = !metadata.exists() || metadata.delete()
        return audioDeleted && metadataDeleted
    }

    private fun validatePcmWav(bytes: ByteArray): Float {
        if (bytes.size < 44 || bytes.size > MAX_WAV_BYTES) {
            throw IllegalArgumentException("O WAV está vazio, incompleto ou excede o limite de 8 MB.")
        }
        fun ascii(offset: Int, count: Int) = String(bytes, offset, count, Charsets.US_ASCII)
        if (ascii(0, 4) != "RIFF" || ascii(8, 4) != "WAVE") {
            throw IllegalArgumentException("O arquivo precisa estar no formato WAV/RIFF.")
        }
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val riffSize = buffer.getInt(4).toLong() and 0xffffffffL
        if (riffSize + 8L != bytes.size.toLong()) {
            throw IllegalArgumentException("O tamanho declarado no cabeçalho WAV não corresponde ao arquivo.")
        }
        var offset = 12
        var format = -1
        var channels = -1
        var sampleRate = -1
        var bitsPerSample = -1
        var dataBytes = -1
        while (offset + 8 <= bytes.size) {
            val chunkId = ascii(offset, 4)
            val chunkSize = buffer.getInt(offset + 4).toLong() and 0xffffffffL
            val start = offset + 8
            val end = start.toLong() + chunkSize
            val paddedEnd = end + (chunkSize and 1L)
            if (end > bytes.size || paddedEnd > bytes.size || end < start) {
                throw IllegalArgumentException("O WAV contém um bloco truncado ou inválido.")
            }
            when (chunkId) {
                "fmt " -> {
                    if (chunkSize < 16) throw IllegalArgumentException("Cabeçalho WAV inválido.")
                    format = buffer.getShort(start).toInt() and 0xffff
                    channels = buffer.getShort(start + 2).toInt() and 0xffff
                    sampleRate = buffer.getInt(start + 4)
                    bitsPerSample = buffer.getShort(start + 14).toInt() and 0xffff
                }
                "data" -> {
                    if (chunkSize > Int.MAX_VALUE) throw IllegalArgumentException("Bloco de áudio muito grande.")
                    dataBytes = chunkSize.toInt()
                }
            }
            offset = paddedEnd.toInt()
        }
        if (offset != bytes.size) throw IllegalArgumentException("Estrutura de blocos WAV inválida.")
        if (format != 1 || channels != 1 || sampleRate != SAMPLE_RATE_HZ || bitsPerSample != 16) {
            throw IllegalArgumentException(
                "Use WAV PCM de 16 bits, mono, 24 kHz. Converta o áudio antes de importar."
            )
        }
        if (dataBytes <= 0 || dataBytes % 2 != 0) {
            throw IllegalArgumentException("O WAV não contém áudio PCM válido.")
        }
        val duration = dataBytes.toFloat() / (SAMPLE_RATE_HZ * 2f)
        if (duration !in MIN_DURATION_SECONDS..MAX_DURATION_SECONDS) {
            throw IllegalArgumentException("A amostra deve ter entre 3 e 30 segundos (atual: %.1f s).".format(duration))
        }
        return duration
    }

    private fun readBounded(input: InputStream, limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            if (output.size().toLong() + count > limit) {
                throw IllegalArgumentException("O WAV excede o limite de 8 MB.")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    companion object {
        private const val SAMPLE_RATE_HZ = 24_000
        private const val MIN_DURATION_SECONDS = 3f
        private const val MAX_DURATION_SECONDS = 30f
        private const val MAX_WAV_BYTES = 8 * 1024 * 1024
        private val PROFILE_ID = Regex("[0-9a-fA-F-]{36}")
        private val PROFILE_WAV_NAME = Regex("[0-9a-fA-F-]{36}\\.wav")
    }
}
