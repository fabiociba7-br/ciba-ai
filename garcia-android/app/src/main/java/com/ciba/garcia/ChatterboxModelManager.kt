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
    private const val REVISION = "c45504bb8d55473a2213db17ec472ed11b69056a"
    private const val BASE = "https://huggingface.co/cstr/chatterbox-GGUF/resolve/" + REVISION + "/"
    private const val T3 = "chatterbox-t3-q4_k.gguf"
    private const val S3 = "chatterbox-s3gen-q4_k.gguf"
    data class Models(val t3: File, val s3: File)

    fun installed(context: Context): Models? {
        val dir = File(context.filesDir, "chatterbox-models")
        val t3 = File(dir, T3); val s3 = File(dir, S3)
        return if (valid(t3) && valid(s3)) Models(t3, s3) else null
    }

    suspend fun download(context: Context, progress: (String) -> Unit = {}): Models = withContext(Dispatchers.IO) {
        val dir = File(context.filesDir, "chatterbox-models").apply { mkdirs() }
        require(StatFs(context.filesDir.absolutePath).availableBytes >= 1_500L * 1024 * 1024) {
            "A Garcia precisa de pelo menos 1,5 GB livres para baixar e preparar os modelos."
        }
        val t3 = File(dir, T3); val s3 = File(dir, S3)
        if (!valid(t3)) downloadOne(T3, t3, progress)
        if (!valid(s3)) downloadOne(S3, s3, progress)
        require(valid(t3) && valid(s3)) { "Os arquivos não passaram na validação GGUF." }
        Models(t3, s3)
    }

    private fun downloadOne(name: String, target: File, progress: (String) -> Unit) {
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
            target.delete()
            require(temp.renameTo(target)) { "Não foi possível finalizar " + name }
        } catch (error: Throwable) {
            temp.delete(); throw error
        } finally { connection.disconnect() }
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
