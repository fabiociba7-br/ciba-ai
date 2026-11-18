package com.ciba.garcia

import android.content.Context
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

internal object ChatterboxModelManager {
    
    private const val BASE = "https://github.com/fabiociba7-br/ciba-ai/releases/download/garcia-chatterbox-v3-models/"
    private const val T3 = "chatterbox-t3-mtl-v3-q4_0.gguf"
    private const val S3 = "chatterbox-s3gen-mtl-v3-q4_0.gguf"
    private const val T3_SHA256 = "d886fba27183c3000becb096b1a16526fafb67fe7abd541d7901040931524d16"
    private const val S3_SHA256 = "ab3b5339f7305d5c35641a4db5024bea6aab9e2376d7f42d388a49b0b8d4145f"
    data class Models(val t3: File, val s3: File)

    fun installed(context: Context): Models? {
        val dir = File(context.filesDir, "chatterbox-models")
        val t3 = File(dir, T3); val s3 = File(dir, S3)
        return if (verified(t3, T3_SHA256) && verified(s3, S3_SHA256)) Models(t3, s3) else null
    }

    suspend fun download(context: Context, progress: (String) -> Unit = {}): Models = withContext(Dispatchers.IO) {
        val dir = File(context.filesDir, "chatterbox-models").apply { mkdirs() }
        require(StatFs(context.filesDir.absolutePath).availableBytes >= 1_500L * 1024 * 1024) {
            "A Garcia precisa de pelo menos 1,5 GB livres para baixar e preparar os modelos."
        }
        val t3 = File(dir, T3); val s3 = File(dir, S3)
        if (!verified(t3, T3_SHA256)) downloadOne(T3, t3, T3_SHA256, progress)
        if (!verified(s3, S3_SHA256)) downloadOne(S3, s3, S3_SHA256, progress)
        require(verified(t3, T3_SHA256) && verified(s3, S3_SHA256)) { "Os arquivos não passaram na validação GGUF." }
        Models(t3, s3)
    }

    private fun downloadOne(name: String, target: File, expectedSha256: String, progress: (String) -> Unit) {
        val temp = File(target.parentFile, name + ".part")
        temp.delete()
        val connection = (URL(BASE + name + "?download=true").openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000; readTimeout = 120_000; instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Garcia-Android/1.0")
        }
        try {
            connection.connect()
            require(connection.responseCode in 200..299) { "Falha HTTP " + connection.responseCode + " ao baixar " + name }
            val expected = connection.contentLengthLong
            progress("Baixando " + name + (if (expected > 0) " (" + (expected / 1048576) + " MB)." else "."))
            connection.inputStream.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val n = input.read(buffer); if (n < 0) break
                        output.write(buffer, 0, n)
                    }
                    output.fd.sync()
                }
            }
            if (expected > 0) require(temp.length() == expected) { "Download incompleto de " + name }
            require(valid(temp)) { "O arquivo " + name + " não é um GGUF válido." }
            require(sha256(temp) == expectedSha256) { "A verificação SHA-256 falhou para " + name + "." }
            target.delete()
            require(temp.renameTo(target)) { "Não foi possível finalizar " + name }
            File(target.parentFile, name + ".sha256").writeText(expectedSha256)
        } catch (error: Throwable) {
            temp.delete(); throw error
        } finally { connection.disconnect() }
    }

    private fun verified(file: File, expectedSha256: String): Boolean {
        val marker = File(file.parentFile, file.name + ".sha256")
        if (!valid(file)) return false
        if (marker.isFile && marker.readText().trim() == expectedSha256) return true
        val matches = runCatching { sha256(file) == expectedSha256 }.getOrDefault(false)
        if (matches) marker.writeText(expectedSha256)
        return matches
    }

    private fun sha256(file: File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun valid(file: File): Boolean {
        if (!file.isFile || file.length() < 100L * 1024 * 1024) return false
        return runCatching {
            FileInputStream(file).use {
                val magic = ByteArray(4)
                it.read(magic) == 4 && String(magic, Charsets.US_ASCII) == "GGUF"
            }
        }.getOrDefault(false)
    }
}
