package com.ciba.garcia

import android.content.Context
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Optional Brazilian Portuguese Parakeet model package.
 * Model weights stay outside the APK and are installed only on user request.
 */
internal class ParakeetModelStore(context: Context) {
    data class Status(
        val installed: Boolean,
        val bytesInstalled: Long,
        val revision: String?,
        val updateAvailable: Boolean = false
    )

    private data class Asset(val name: String, val size: Long, val sha256: String)

    private val app = context.applicationContext
    private val directory = File(app.filesDir, "models/parakeet-ptbr")
    private val prefs = app.getSharedPreferences("garcia_model_catalog", Context.MODE_PRIVATE)

    private val assets = listOf(
        Asset("encoder.int8.onnx", 652_282_302L, "260aff7bf778b016b42385e186d88a57224bd6958001993dbb6070a9a75b6690"),
        Asset("decoder.int8.onnx", 11_845_274L, "6b77e877b1dc29ebead07c0f461a7385d1ac5f8eff5be6422fdddb390d4a9967"),
        Asset("joiner.int8.onnx", 6_355_277L, "eb365a33945103cb787aa849b344cbf2abc093b43211e3b969ff97be3fdfc0e4"),
        Asset("tokens.txt", 93_939L, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d")
    )

    fun status(): Status {
        val installedBytes = assets.sumOf { asset ->
            File(directory, asset.name).takeIf { it.isFile && it.length() == asset.size }?.length() ?: 0L
        }
        val complete = installedBytes == assets.sumOf { it.size }
        return Status(complete, installedBytes, prefs.getString("revision", null))
    }

    fun checkForUpdates(): Status {
        val connection = URL(MODEL_API).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("User-Agent", "Garcia-Android")
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            val remoteRevision = JSONObject(response).optString("sha").takeIf { it.matches(Regex("[0-9a-f]{40}")) }
                ?: throw IllegalStateException("O catálogo remoto não informou uma revisão válida do modelo.")
            val current = status()
            val installedRevision = current.revision
            val update = current.installed && installedRevision != null && installedRevision != remoteRevision
            prefs.edit().putString("latest_revision", remoteRevision).apply()
            return current.copy(updateAvailable = update)
        } finally {
            connection.disconnect()
        }
    }

    fun download(onProgress: (Long, Long) -> Unit): Status {
        val revision = prefs.getString("latest_revision", null)
            ?: checkForUpdates().let { prefs.getString("latest_revision", null) }
            ?: throw IllegalStateException("Não foi possível consultar a versão atual do modelo.")
        directory.mkdirs()
        val totalBytes = assets.sumOf { it.size }
        var completedBytes = 0L
        for (asset in assets) {
            val destination = File(directory, asset.name)
            if (destination.isFile && destination.length() == asset.size && sha256(destination) == asset.sha256) {
                completedBytes += asset.size
                onProgress(completedBytes, totalBytes)
                continue
            }
            val temporary = File(directory, "${asset.name}.download")
            temporary.delete()
            val connection = URL("$MODEL_FILES/$revision/${asset.name}?download=true").openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 20_000
                connection.readTimeout = 60_000
                connection.setRequestProperty("User-Agent", "Garcia-Android")
                require(connection.responseCode in 200..299) { "Falha ao baixar ${asset.name}: HTTP ${connection.responseCode}" }
                var assetBytes = 0L
                BufferedInputStream(connection.inputStream).use { input ->
                    BufferedOutputStream(temporary.outputStream()).use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            assetBytes += count
                            require(assetBytes <= asset.size) { "O arquivo ${asset.name} excedeu o tamanho esperado." }
                            output.write(buffer, 0, count)
                            onProgress(completedBytes + assetBytes, totalBytes)
                        }
                    }
                }
                require(assetBytes == asset.size) { "Download incompleto de ${asset.name}." }
                require(sha256(temporary) == asset.sha256) { "A verificação SHA-256 de ${asset.name} falhou; arquivo descartado." }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
                completedBytes += assetBytes
                onProgress(completedBytes, totalBytes)
            } catch (error: Exception) {
                temporary.delete()
                throw error
            } finally {
                connection.disconnect()
            }
        }
        prefs.edit().putString("revision", revision).apply()
        return status()
    }

    fun modelDirectory(): File = directory

    fun remove() {
        directory.deleteRecursively()
        prefs.edit().remove("revision").remove("latest_revision").apply()
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

    companion object {
        const val MODEL_ID = "joaorura/parakeet-tdt-0.6b-v3-ptBR-sherpa-onnx-int8"
        const val MODEL_SIZE_BYTES = 670_576_792L
        const val MODEL_SIZE_LABEL = "aprox. 640 MiB"
        const val LICENSE = "CC-BY-4.0"
        private const val MODEL_API = "https://huggingface.co/api/models/$MODEL_ID"
        private const val MODEL_FILES = "https://huggingface.co/$MODEL_ID/resolve"
    }
}
