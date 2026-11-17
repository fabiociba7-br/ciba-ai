package com.ciba.garcia

import android.content.Context
import android.net.Uri
import java.io.File
import java.security.MessageDigest
import java.net.URL
import java.io.BufferedInputStream
import java.io.BufferedOutputStream

/** Downloads the approved Whisper model over HTTPS, verifies its SHA-256, and keeps it in app-private storage. */
internal class WhisperModelStore(context: Context) {
    private val appContext = context.applicationContext
    private val modelDirectory = File(appContext.filesDir, "whisper-models")
    private val metadata = appContext.getSharedPreferences("whisper_model", Context.MODE_PRIVATE)

    data class ModelInfo(val file: File, val sha256: String, val sizeBytes: Long) {
        val modelId: String get() = "whisper-$sha256"
    }

    fun downloadModel(onProgress: (Long, Long) -> Unit = { _, _ -> }): ModelInfo {
        modelDirectory.mkdirs()
        val temporary = File(modelDirectory, "model.ggml.download")
        val destination = File(modelDirectory, "model.ggml")
        temporary.delete()
        try {
            val connection = URL(MODEL_URL).openConnection().apply {
                connectTimeout = 20_000
                readTimeout = 30_000
                useCaches = false
                setRequestProperty("User-Agent", "Garcia-Android/1.1.5")
            }
            connection.connect()
            val expectedLength = connection.contentLengthLong
            require(expectedLength == -1L || expectedLength in MIN_MODEL_BYTES..MAX_MODEL_BYTES) {
                "O servidor informou um tamanho inválido para o modelo Whisper."
            }
            var total = 0L
            BufferedInputStream(connection.getInputStream()).use { input ->
                BufferedOutputStream(temporary.outputStream()).use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_MODEL_BYTES) { "O modelo excedeu o tamanho máximo permitido." }
                        output.write(buffer, 0, count)
                        onProgress(total, expectedLength.coerceAtLeast(0L))
                    }
                }
            }
            require((expectedLength <= 0L || total == expectedLength) && total in MIN_MODEL_BYTES..MAX_MODEL_BYTES) {
                "Download incompleto do modelo Whisper. Tente novamente."
            }
            val digest = sha256(temporary)
            require(digest == APPROVED_TINY_Q5_1_SHA256) {
                "A verificação de segurança do modelo Whisper falhou. O arquivo foi descartado."
            }
            require(hasWhisperMagic(temporary)) { "O arquivo baixado não é um modelo Whisper válido." }
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
            metadata.edit().putString("model_path", destination.absolutePath)
                .putString("model_sha256", digest).apply()
            return ModelInfo(destination, digest, destination.length())
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    fun importModel(uri: Uri): ModelInfo {
        modelDirectory.mkdirs()
        val temporary = File(modelDirectory, "model.ggml.tmp")
        val destination = File(modelDirectory, "model.ggml")
        var total = 0L
        appContext.contentResolver.openInputStream(uri)?.use { input ->
            temporary.outputStream().buffered().use { output ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total in MIN_MODEL_BYTES..MAX_MODEL_BYTES) {
                        "O modelo precisa ter entre 10 MB e 2 GB."
                    }
                    output.write(buffer, 0, count)
                }
            }
        } ?: throw IllegalArgumentException("Não foi possível abrir o arquivo selecionado.")
        try {
            require(total >= MIN_MODEL_BYTES) { "O arquivo selecionado é pequeno demais para ser um modelo Whisper." }
            val digest = sha256(temporary)
            require(hasWhisperMagic(temporary)) { "O arquivo não parece ser um modelo compatível com whisper.cpp." }
            require(digest == APPROVED_TINY_Q5_1_SHA256) {
                "Modelo não aprovado. Nesta etapa, importe somente ggml-tiny-q5_1.bin da origem oficial documentada."
            }
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
            metadata.edit().putString("model_path", destination.absolutePath)
                .putString("model_sha256", digest).apply()
            return ModelInfo(destination, digest, destination.length())
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    fun loadSavedModel(): ModelInfo? {
        val path = metadata.getString("model_path", null) ?: return null
        val expectedHash = metadata.getString("model_sha256", null) ?: return null
        val file = File(path)
        if (!file.isFile || file.length() !in MIN_MODEL_BYTES..MAX_MODEL_BYTES) return null
        val actualHash = sha256(file)
        if (!actualHash.equals(expectedHash, ignoreCase = true) || actualHash != APPROVED_TINY_Q5_1_SHA256 || !hasWhisperMagic(file)) return null
        return ModelInfo(file, actualHash, file.length())
    }

    fun forgetModel() {
        metadata.edit().clear().apply()
        File(modelDirectory, "model.ggml").delete()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun hasWhisperMagic(file: File): Boolean =
        file.inputStream().buffered().use { input ->
            val magic = ByteArray(4)
            input.read(magic) == 4 && magic.contentEquals(byteArrayOf(0x6c, 0x6d, 0x67, 0x67))
        }

    companion object {
        private const val MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin"
        private const val APPROVED_TINY_Q5_1_SHA256 = "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"
        private const val MIN_MODEL_BYTES = 10L * 1024 * 1024
        private const val MAX_MODEL_BYTES = 2L * 1024 * 1024 * 1024
    }
}
