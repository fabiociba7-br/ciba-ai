package com.ciba.garcia

import android.content.Context
import android.net.Uri
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal object ChatterboxModelManager {
    private const val BASE = "https://github.com/fabiociba7-br/ciba-ai/releases/download/garcia-chatterbox-v3-models/"
    private const val T3 = "chatterbox-t3-mtl-v3-q4_0.gguf"
    private const val S3 = "chatterbox-s3gen-mtl-v3-q4_0.gguf"
    private const val T3_SHA256 = "d886fba27183c3000becb096b1a16526fafb67fe7abd541d7901040931524d16"
    private const val S3_SHA256 = "ab3b5339f7305d5c35641a4db5024bea6aab9e2376d7f42d388a49b0b8d4145f"
    private val verifiedFiles = ConcurrentHashMap<String, FileStamp>()

    data class Models(val t3: File, val s3: File)
    data class DownloadProgress(val fileName: String, val downloadedBytes: Long, val totalBytes: Long)

    fun isVerifiedInMemory(context: Context): Boolean {
        val dir = File(context.filesDir, "chatterbox-models")
        val t3 = File(dir, T3)
        val s3 = File(dir, S3)
        return valid(t3) && valid(s3) &&
            verifiedFiles[t3.absolutePath] == FileStamp(t3.length(), t3.lastModified()) &&
            verifiedFiles[s3.absolutePath] == FileStamp(s3.length(), s3.lastModified())
    }

    fun installed(context: Context): Models? {
        val dir = File(context.filesDir, "chatterbox-models")
        val t3 = File(dir, T3)
        val s3 = File(dir, S3)
        return if (verified(t3, T3_SHA256) && verified(s3, S3_SHA256)) Models(t3, s3) else null
    }

    suspend fun importModels(context: Context, uris: List<Uri>, progress: (DownloadProgress) -> Unit = {}): Models = withContext(Dispatchers.IO) {
        require(uris.size == 2) { "Selecione os dois arquivos GGUF do Chatterbox." }
        val dir = File(context.filesDir, "chatterbox-models").apply { mkdirs() }
        val required = if (File(dir, T3).exists() || File(dir, S3).exists()) 2_500L else 1_250L
        require(StatFs(context.filesDir.absolutePath).availableBytes >= required * 1024 * 1024) {
            "A Garcia precisa de espaço livre suficiente para importar e validar os dois modelos."
        }
        val staging = File(dir, "import-" + UUID.randomUUID()).apply { mkdirs() }
        try {
            val imported = mutableSetOf<String>()
            uris.forEachIndexed { index, uri ->
                val resolver = context.contentResolver
                val displayName = resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: "modelo-${index + 1}.gguf"
                val total = resolver.query(uri, arrayOf(android.provider.OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else -1L
                } ?: -1L
                val temp = File(staging, "model-${index + 1}.part")
                try {
                    var copied = 0L
                    progress(DownloadProgress(displayName, copied, total))
                    val input = resolver.openInputStream(uri) ?: error("Não foi possível abrir $displayName.")
                    input.use { source ->
                        FileOutputStream(temp).use { output ->
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                val count = source.read(buffer)
                                if (count < 0) break
                                copied += count
                                require(copied <= 1_500L * 1024 * 1024) { "O arquivo $displayName excede o limite esperado." }
                                output.write(buffer, 0, count)
                                progress(DownloadProgress(displayName, copied, total))
                            }
                            output.fd.sync()
                        }
                    }
                    require(total <= 0L || copied == total) { "O arquivo $displayName foi copiado incompleto." }
                    require(valid(temp)) { "$displayName não é um arquivo GGUF válido." }
                    val hash = sha256(temp)
                    val targetName = when (hash) {
                        T3_SHA256 -> T3
                        S3_SHA256 -> S3
                        else -> error("O SHA-256 de $displayName não corresponde a nenhum dos modelos oficiais.")
                    }
                    require(imported.add(targetName)) { "O mesmo modelo foi selecionado duas vezes." }
                    val stagedModel = File(staging, targetName)
                    check(temp.renameTo(stagedModel)) { "Não foi possível preparar $targetName." }
                    File(staging, targetName + ".sha256").writeText(hash)
                } finally {
                    temp.delete()
                }
            }
            val stagedT3 = File(staging, T3)
            val stagedS3 = File(staging, S3)
            require(verified(stagedT3, T3_SHA256) && verified(stagedS3, S3_SHA256)) {
                "Importação incompleta. Selecione os dois modelos oficiais: T3 e S3Gen."
            }
            replacePair(dir, stagedT3, stagedS3)
            require(installed(context) != null) { "Os modelos importados não passaram na validação final." }
            Models(File(dir, T3), File(dir, S3))
        } finally {
            staging.deleteRecursively()
        }
    }

    suspend fun verifyChecksumFile(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            ?: error("Não foi possível abrir o arquivo SHA256SUMS.")
        val normalized = text.lowercase()
        require(normalized.contains(T3_SHA256) && normalized.contains(S3_SHA256)) {
            "O SHA256SUMS selecionado não contém os hashes oficiais dos dois modelos Chatterbox."
        }
        "Arquivo SHA256SUMS reconhecido: os dois hashes oficiais conferem."
    }

    suspend fun download(context: Context, progress: (DownloadProgress) -> Unit = {}): Models = withContext(Dispatchers.IO) {
        val dir = File(context.filesDir, "chatterbox-models").apply { mkdirs() }
        require(StatFs(context.filesDir.absolutePath).availableBytes >= 1_500L * 1024 * 1024) {
            "A Garcia precisa de pelo menos 1,5 GB livres para baixar e preparar os modelos."
        }
        val t3 = File(dir, T3)
        val s3 = File(dir, S3)
        if (!verified(t3, T3_SHA256)) downloadOne(T3, t3, T3_SHA256, progress)
        if (!verified(s3, S3_SHA256)) downloadOne(S3, s3, S3_SHA256, progress)
        require(verified(t3, T3_SHA256) && verified(s3, S3_SHA256)) { "Os arquivos não passaram na validação GGUF." }
        Models(t3, s3)
    }

    private fun downloadOne(name: String, target: File, expectedSha256: String, progress: (DownloadProgress) -> Unit) {
        val temp = File(target.parentFile, name + "." + UUID.randomUUID() + ".part")
        val connection = (URL(BASE + name + "?download=true").openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 120_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Garcia-Android/1.0")
        }
        try {
            connection.connect()
            require(connection.responseCode in 200..299) { "Falha HTTP ${connection.responseCode} ao baixar $name." }
            val expected = connection.contentLengthLong
            var downloaded = 0L
            progress(DownloadProgress(name, downloaded, expected))
            connection.inputStream.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        progress(DownloadProgress(name, downloaded, expected))
                    }
                    output.fd.sync()
                }
            }
            if (expected > 0) require(temp.length() == expected) { "Download incompleto de $name." }
            require(valid(temp)) { "O arquivo $name não é um GGUF válido." }
            require(sha256(temp) == expectedSha256) { "A verificação SHA-256 falhou para $name." }
            val backup = File(target.parentFile, target.name + ".backup")
            if (target.exists()) {
                backup.delete()
                check(target.renameTo(backup)) { "Não foi possível preservar o modelo anterior." }
            }
            try {
                check(temp.renameTo(target)) { "Não foi possível finalizar $name." }
                backup.delete()
            } catch (error: Throwable) {
                target.delete()
                if (backup.exists()) backup.renameTo(target)
                throw error
            }
            verifiedFiles.remove(target.absolutePath)
        } catch (error: Throwable) {
            temp.delete()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun replacePair(dir: File, stagedT3: File, stagedS3: File) {
        val backup = File(dir, "backup-" + UUID.randomUUID()).apply { mkdirs() }
        val targetT3 = File(dir, T3)
        val targetS3 = File(dir, S3)
        try {
            if (targetT3.exists()) check(targetT3.renameTo(File(backup, T3))) { "Não foi possível preservar o T3 anterior." }
            if (targetS3.exists()) check(targetS3.renameTo(File(backup, S3))) { "Não foi possível preservar o S3Gen anterior." }
            check(stagedT3.renameTo(targetT3)) { "Não foi possível instalar o modelo T3." }
            check(stagedS3.renameTo(targetS3)) { "Não foi possível instalar o modelo S3Gen." }
            File(targetT3.parentFile, T3 + ".sha256").writeText(T3_SHA256)
            File(targetS3.parentFile, S3 + ".sha256").writeText(S3_SHA256)
            verifiedFiles.remove(targetT3.absolutePath)
            verifiedFiles.remove(targetS3.absolutePath)
            backup.deleteRecursively()
        } catch (error: Throwable) {
            targetT3.delete()
            targetS3.delete()
            val oldT3 = File(backup, T3)
            val oldS3 = File(backup, S3)
            if (oldT3.exists()) oldT3.renameTo(targetT3)
            if (oldS3.exists()) oldS3.renameTo(targetS3)
            throw error
        } finally {
            backup.deleteRecursively()
        }
    }

    private fun verified(file: File, expectedSha256: String): Boolean {
        if (!valid(file)) return false
        val stamp = FileStamp(file.length(), file.lastModified())
        if (verifiedFiles[file.absolutePath] == stamp) return true
        val matches = runCatching { sha256(file) == expectedSha256 }.getOrDefault(false)
        if (matches) {
            verifiedFiles[file.absolutePath] = stamp
            File(file.parentFile, file.name + ".sha256").writeText(expectedSha256)
        } else {
            verifiedFiles.remove(file.absolutePath)
        }
        return matches
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun valid(file: File): Boolean {
        if (!file.isFile || file.length() < 100L * 1024 * 1024) return false
        return runCatching {
            FileInputStream(file).use { input ->
                val magic = ByteArray(4)
                input.read(magic) == 4 && String(magic, Charsets.US_ASCII) == "GGUF"
            }
        }.getOrDefault(false)
    }

    private data class FileStamp(val length: Long, val modified: Long)
}
