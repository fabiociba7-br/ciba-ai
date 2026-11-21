package com.ciba.garcia.voice.pockettts

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipInputStream

/** Imports and manages Pocket TTS model packs entirely inside Garcia's private storage. */
internal class PocketTtsModelPackManager(private val privateRoot: File) {
    data class InstalledPack(
        val id: String,
        val name: String,
        val languageTag: String,
        val precision: String,
        val directory: File,
        val modelsDirectory: File,
        val voicesDirectory: File,
        val temperature: Float,
        val lsdSteps: Int,
        val threads: Int,
        val sentencePauseMs: Int,
        val maxTextTokens: Int
    )

    fun installPack(zipInput: InputStream): InstalledPack {
        if (!privateRoot.exists() && !privateRoot.mkdirs()) {
            throw IllegalStateException("Não foi possível criar o armazenamento privado dos modelos.")
        }
        val root = privateRoot.canonicalFile
        val staging = File(root, ".import-${UUID.randomUUID()}").canonicalFile
        if (!staging.mkdirs()) throw IllegalStateException("Não foi possível preparar a importação.")
        val checksums = linkedMapOf<String, String>()
        val seen = hashSetOf<String>()
        var totalBytes = 0L
        var entryCount = 0

        try {
            ZipInputStream(BufferedInputStream(zipInput)).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    entryCount++
                    if (entryCount > MAX_ENTRIES) throw IllegalArgumentException("O ZIP contém entradas demais.")
                    val name = safeEntryName(entry.name)
                    if (!seen.add(name)) throw IllegalArgumentException("O ZIP contém um caminho duplicado: $name")
                    if (name == "integrity.sha256") throw IllegalArgumentException("O ZIP usa um arquivo reservado.")
                    val destination = File(staging, name).canonicalFile
                    if (!destination.path.startsWith(staging.path + File.separator)) {
                        throw IllegalArgumentException("Caminho inválido no ZIP: $name")
                    }
                    if (entry.isDirectory) {
                        validateAllowedDirectory(name)
                        if (!destination.exists() && !destination.mkdirs()) {
                            throw IllegalStateException("Não foi possível criar a pasta $name.")
                        }
                    } else {
                        validateAllowedPath(name)
                        if (!destination.parentFile.exists() && !destination.parentFile.mkdirs()) {
                            throw IllegalStateException("Não foi possível criar a pasta de $name.")
                        }
                        val digest = MessageDigest.getInstance("SHA-256")
                        var fileBytes = 0L
                        BufferedOutputStream(FileOutputStream(destination)).use { output ->
                            val buffer = ByteArray(BUFFER_SIZE)
                            while (true) {
                                val count = zip.read(buffer)
                                if (count < 0) break
                                fileBytes += count
                                totalBytes += count
                                if (fileBytes > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_BYTES) {
                                    throw IllegalArgumentException("O pacote excede o limite de tamanho permitido.")
                                }
                                digest.update(buffer, 0, count)
                                output.write(buffer, 0, count)
                            }
                        }
                        if (fileBytes == 0L) throw IllegalArgumentException("O pacote contém arquivo vazio: $name")
                        checksums[name] = digest.digest().toHex()
                    }
                    zip.closeEntry()
                }
            }

            val manifestFile = File(staging, "manifest.json")
            if (!manifestFile.isFile || manifestFile.length() > MAX_MANIFEST_BYTES) {
                throw IllegalArgumentException("manifest.json ausente ou maior que 64 KB.")
            }
            val manifest = JSONObject(manifestFile.readText(Charsets.UTF_8))
            val id = manifest.getString("id")
            if (!PACK_ID.matches(id)) throw IllegalArgumentException("Identificador de pacote inválido.")
            val name = manifest.optString("name", id).trim().take(100)
            val languageTag = manifest.getString("languageTag")
            if (!LANGUAGE_TAG.matches(languageTag) || Locale.forLanguageTag(languageTag).language.isBlank()) {
                throw IllegalArgumentException("Idioma BCP-47 inválido no manifesto.")
            }
            val precision = manifest.optString("precision", "fp32")
            if (precision != "fp32" && precision != "int8") {
                throw IllegalArgumentException("Precisão de modelo não suportada.")
            }
            val modelDirectory = File(staging, "models")
            val voiceDirectory = File(staging, "voices")
            val requiredModels = if (precision == "int8") INT8_MODELS else FP32_MODELS
            val missing = requiredModels.filterNot { File(modelDirectory, it).isFile }
            if (missing.isNotEmpty()) throw IllegalArgumentException(
                "Pacote incompleto. Modelos ausentes: ${missing.joinToString()}"
            )
            if (!voiceDirectory.exists() && !voiceDirectory.mkdirs()) {
                throw IllegalStateException("Não foi possível preparar a pasta de vozes.")
            }
            val wavFiles = voiceDirectory.walkTopDown().filter { it.isFile }.toList()
            if (wavFiles.any { !it.name.endsWith(".wav", ignoreCase = true) }) {
                throw IllegalArgumentException("A pasta voices só pode conter arquivos WAV.")
            }
            val checksumFile = File(staging, "integrity.sha256")
            checksumFile.writeText(checksums.toSortedMap().entries.joinToString("\n") { "${it.value}  ${it.key}" } + "\n")

            val destination = File(root, id).canonicalFile
            if (!destination.path.startsWith(root.path + File.separator) || destination.exists()) {
                throw IllegalArgumentException("Já existe um pacote com o identificador $id.")
            }
            if (!staging.renameTo(destination)) {
                throw IllegalStateException("Não foi possível concluir a instalação atômica do pacote.")
            }
            return readPack(destination)
        } catch (error: Throwable) {
            staging.deleteRecursively()
            throw error
        }
    }

    fun listInstalledPacks(): List<InstalledPack> {
        if (!privateRoot.isDirectory) return emptyList()
        return privateRoot.listFiles().orEmpty()
            .filter { it.isDirectory && PACK_ID.matches(it.name) && File(it, "manifest.json").isFile }
            .mapNotNull { directory -> runCatching { readPack(directory) }.getOrNull() }
            .sortedBy { it.name.lowercase(Locale.ROOT) }
    }

    fun deletePack(id: String): Boolean {
        require(PACK_ID.matches(id)) { "Identificador de pacote inválido." }
        val root = privateRoot.canonicalFile
        val target = File(root, id).canonicalFile
        require(target.parentFile == root) { "Diretório de pacote inválido." }
        return !target.exists() || target.deleteRecursively()
    }

    private fun readPack(directory: File): InstalledPack {
        val manifest = JSONObject(File(directory, "manifest.json").readText(Charsets.UTF_8))
        val precision = manifest.optString("precision", "fp32")
        require(precision == "fp32" || precision == "int8")
        return InstalledPack(
            id = manifest.getString("id"),
            name = manifest.optString("name", manifest.getString("id")),
            languageTag = manifest.getString("languageTag"),
            precision = precision,
            directory = directory,
            modelsDirectory = File(directory, "models"),
            voicesDirectory = File(directory, "voices"),
            temperature = manifest.optDouble("temperature", 0.5).toFloat().coerceIn(0f, 2f),
            lsdSteps = manifest.optInt("lsdSteps", 1).coerceIn(1, 8),
            threads = manifest.optInt("threads", 2).coerceIn(1, 8),
            sentencePauseMs = manifest.optInt("sentencePauseMs", 250).coerceIn(0, 2000),
            maxTextTokens = manifest.optInt("maxTextTokens", 50).coerceIn(10, 200)
        )
    }

    private fun safeEntryName(raw: String): String {
        if (raw.isBlank() || raw.startsWith('/') || raw.startsWith('\\') ||
            raw.contains('\\') || raw.contains('\u0000') || raw.contains(':')) {
            throw IllegalArgumentException("Caminho inválido no ZIP.")
        }
        val normalized = raw.removeSuffix("/")
        if (normalized.isBlank() || normalized.split('/').any { it.isBlank() || it == "." || it == ".." }) {
            throw IllegalArgumentException("Caminho inseguro no ZIP: $raw")
        }
        return normalized
    }

    private fun validateAllowedDirectory(path: String) {
        val allowed = path == "models" || path == "voices" ||
            path.startsWith("voices/")
        if (!allowed) throw IllegalArgumentException("Diretório não permitido no pacote: $path")
    }

    private fun validateAllowedPath(path: String) {
        val allowedRoot = path == "manifest.json" ||
            path == "MODEL_LICENSE.txt" ||
            path == "VOICE_ATTRIBUTION.md" ||
            path.startsWith("models/") ||
            path.startsWith("voices/")
        if (!allowedRoot) throw IllegalArgumentException("Arquivo não permitido no pacote: $path")
        if (path.startsWith("models/") &&
            (path.count { it == '/' } != 1 || path.removePrefix("models/") !in ALL_MODEL_FILES)) {
            throw IllegalArgumentException("Arquivo de modelo desconhecido: $path")
        }
        if (path.startsWith("voices/") && !path.endsWith(".wav", ignoreCase = true)) {
            throw IllegalArgumentException("A pasta voices só pode conter arquivos WAV.")
        }
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val BUFFER_SIZE = 64 * 1024
        private const val MAX_ENTRIES = 256
        private const val MAX_ENTRY_BYTES = 2L * 1024 * 1024 * 1024
        private const val MAX_TOTAL_BYTES = 3L * 1024 * 1024 * 1024
        private const val MAX_MANIFEST_BYTES = 64L * 1024
        private val PACK_ID = Regex("[a-z0-9][a-z0-9._-]{1,63}")
        private val LANGUAGE_TAG = Regex("[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*")
        private val FP32_MODELS = setOf(
            "mimi_encoder.onnx", "text_conditioner.onnx", "tokenizer.model",
            "flow_lm_main.onnx", "flow_lm_flow.onnx", "mimi_decoder.onnx"
        )
        private val INT8_MODELS = setOf(
            "mimi_encoder.onnx", "text_conditioner.onnx", "tokenizer.model",
            "flow_lm_main_int8.onnx", "flow_lm_flow_int8.onnx", "mimi_decoder_int8.onnx"
        )
        private val ALL_MODEL_FILES = FP32_MODELS + INT8_MODELS
    }
}
