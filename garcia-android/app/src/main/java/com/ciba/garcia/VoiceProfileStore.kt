package com.ciba.garcia

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

internal data class GarciaVoiceProfile(
    val id: String,
    val name: String,
    val sample: File,
    val wav: File,
    val createdAt: Long,
    val durationMs: Long,
    val sampleSha256: String,
    val wavSha256: String
)

internal class VoiceProfileStore(context: Context) {
    private val app = context.applicationContext
    private val root = File(app.filesDir, "voice-profiles").apply { mkdirs() }
    private val imports = File(app.cacheDir, "voice-imports").apply { mkdirs() }
    private val prefs = app.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
    private val voicePrefs = app.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)

    fun importAudio(uri: Uri): File {
        val target = File(imports, "reference-${UUID.randomUUID()}.audio")
        val input = app.contentResolver.openInputStream(uri) ?: error("Não foi possível abrir o áudio selecionado.")
        input.use { source ->
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(64 * 1024)
                var copied = 0L
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) break
                    copied += count
                    require(copied <= MAX_AUDIO_BYTES) { "O áudio deve ter no máximo 50 MB." }
                    output.write(buffer, 0, count)
                }
                output.fd.sync()
            }
        }
        runCatching { validateAudio(target) }.onFailure { target.delete(); throw it }
        return target
    }

    fun saveRecording(source: File): File {
        validateAudio(source)
        val target = File(imports, "recording-${UUID.randomUUID()}.m4a")
        source.copyTo(target, overwrite = true)
        validateAudio(target)
        return target
    }

    fun save(source: File, name: String, normalizedWav: File): GarciaVoiceProfile {
        require(name.isNotBlank()) { "Digite um nome para o perfil." }
        val duration = validateAudio(source)
        validateNormalizedWav(normalizedWav)
        val id = UUID.randomUUID().toString()
        val directory = File(root, id)
        check(directory.mkdirs()) { "Não foi possível criar o perfil de voz." }
        val extension = source.extension.lowercase().filter { it.isLetterOrDigit() }.take(8).ifBlank { "audio" }
        val sample = File(directory, "reference.$extension")
        val wav = File(directory, "reference.wav")
        try {
            source.copyTo(sample, overwrite = true)
            normalizedWav.copyTo(wav, overwrite = true)
            val sampleHash = sha256(sample)
            val wavHash = sha256(wav)
            val profile = GarciaVoiceProfile(id, name.trim(), sample, wav, System.currentTimeMillis(), duration, sampleHash, wavHash)
            val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
            json.put(id, JSONObject()
                .put("name", profile.name)
                .put("sample", sample.name)
                .put("wav", wav.name)
                .put("created_at", profile.createdAt)
                .put("duration_ms", profile.durationMs)
                .put("sample_sha256", profile.sampleSha256)
                .put("wav_sha256", profile.wavSha256))
            check(prefs.edit().putString("profiles_json", json.toString()).commit()) { "Não foi possível salvar os dados do perfil." }
            return profile
        } catch (error: Throwable) {
            directory.deleteRecursively()
            throw error
        } finally {
            if (isInside(imports, source)) source.delete()
            if (isInside(app.cacheDir, normalizedWav)) normalizedWav.delete()
        }
    }

    fun profiles(): List<GarciaVoiceProfile> {
        val json = runCatching { JSONObject(prefs.getString("profiles_json", "{}").orEmpty()) }.getOrElse { JSONObject() }
        val result = mutableListOf<GarciaVoiceProfile>()
        val keys = json.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val item = json.optJSONObject(id) ?: continue
            val directory = File(root, id)
            val sample = File(directory, item.optString("sample"))
            val wav = File(directory, item.optString("wav"))
            if (!isInside(root, sample) || !isInside(root, wav) || !sample.isFile || !wav.isFile) continue
            val sampleHash = item.optString("sample_sha256")
            val wavHash = item.optString("wav_sha256")
            if (sampleHash.isBlank() || wavHash.isBlank()) continue
            val hashesValid = runCatching { sha256(sample) == sampleHash && sha256(wav) == wavHash }.getOrDefault(false)
            if (!hashesValid) continue
            result += GarciaVoiceProfile(
                id = id,
                name = item.optString("name", "Minha voz"),
                sample = sample,
                wav = wav,
                createdAt = item.optLong("created_at", 0L),
                durationMs = item.optLong("duration_ms", 0L),
                sampleSha256 = sampleHash,
                wavSha256 = wavHash
            )
        }
        return result.sortedBy { it.name.lowercase() }
    }

    fun activeProfileId(): String? {
        val mode = voicePrefs.getString("voice_mode", "system")
        if (mode != "cloned" && !voicePrefs.getString("voice_id", "").orEmpty().startsWith("clone:")) return null
        return voicePrefs.getString("cloned_voice_id", null)
            ?: prefs.getString("active_profile_id", null)
            ?: voicePrefs.getString("voice_id", null)?.removePrefix("clone:")?.takeIf { it.isNotBlank() }
    }

    fun currentProfile(): GarciaVoiceProfile? = activeProfileId()?.let { id -> profiles().firstOrNull { it.id == id } }
    fun currentFile(): File? = currentProfile()?.sample
    fun currentWav(): File? = currentProfile()?.wav
    fun currentName(): String = currentProfile()?.name.orEmpty()

    fun select(profile: GarciaVoiceProfile) {
        val verified = profiles().firstOrNull { it.id == profile.id } ?: error("O perfil de voz não passou na validação local.")
        val currentVoice = voicePrefs.getString("voice_id", null)
        val editor = voicePrefs.edit()
            .putString("voice_mode", "cloned")
            .putString("cloned_voice_id", verified.id)
            .putString("voice_id", "clone:" + verified.id)
        if (!currentVoice.isNullOrBlank() && !currentVoice.startsWith("clone:")) editor.putString("system_voice_id", currentVoice)
        check(editor.commit()) { "Não foi possível ativar o perfil de voz." }
        prefs.edit().putString("active_profile_id", verified.id).apply()
    }

    fun rename(profileId: String, newName: String) {
        require(newName.isNotBlank()) { "Digite um nome para o perfil." }
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        val item = json.optJSONObject(profileId) ?: error("Perfil não encontrado.")
        item.put("name", newName.trim())
        json.put(profileId, item)
        check(prefs.edit().putString("profiles_json", json.toString()).commit()) { "Não foi possível renomear o perfil." }
    }

    fun delete(profileId: String) {
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        json.remove(profileId)
        check(prefs.edit().putString("profiles_json", json.toString()).commit()) { "Não foi possível atualizar os perfis salvos." }
        val directory = File(root, profileId)
        if (isInside(root, directory)) directory.deleteRecursively()
        if (activeProfileId() == profileId) {
            val systemVoice = voicePrefs.getString("system_voice_id", null)
            voicePrefs.edit()
                .putString("voice_mode", "system")
                .remove("cloned_voice_id")
                .remove("system_voice_id")
                .apply {
                    if (systemVoice.isNullOrBlank()) remove("voice_id") else putString("voice_id", systemVoice)
                }
                .commit()
            prefs.edit().remove("active_profile_id").apply()
        }
    }

    private fun validateAudio(file: File): Long {
        require(file.isFile && file.length() > 1024L) { "O arquivo de áudio está vazio ou inválido." }
        require(file.length() <= MAX_AUDIO_BYTES) { "O áudio deve ter no máximo 50 MB." }
        val metadata = MediaMetadataRetriever()
        try {
            metadata.setDataSource(file.absolutePath)
            require(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes") {
                "O arquivo selecionado não contém uma faixa de áudio."
            }
            val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            require(duration in MIN_DURATION_MS..MAX_DURATION_MS) {
                "Use uma gravação entre 5 e 30 segundos. Para melhores resultados, prefira 10 a 15 segundos de fala clara."
            }
            return duration
        } finally {
            metadata.release()
        }
    }

    private fun validateNormalizedWav(file: File) {
        require(file.isFile && file.length() > 44L) { "A gravação convertida está vazia." }
        RandomAccessFile(file, "r").use { wav ->
            val header = ByteArray(44)
            wav.readFully(header)
            val data = java.nio.ByteBuffer.wrap(header).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            require(String(header, 0, 4, Charsets.US_ASCII) == "RIFF" && String(header, 8, 4, Charsets.US_ASCII) == "WAVE") {
                "A gravação convertida não é WAV válido."
            }
            require((data.getShort(20).toInt() and 0xffff) == 1 &&
                (data.getShort(22).toInt() and 0xffff) == 1 &&
                data.getInt(24) == 24_000 &&
                (data.getShort(34).toInt() and 0xffff) == 16) {
                "A gravação precisa ser PCM mono, 24 kHz e 16 bits."
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun isInside(parent: File, child: File): Boolean {
        val rootPath = parent.canonicalFile.toPath()
        val childPath = child.canonicalFile.toPath()
        return childPath.startsWith(rootPath) && childPath != rootPath
    }

    companion object {
        private const val MAX_AUDIO_BYTES = 50L * 1024 * 1024
        private const val MIN_DURATION_MS = 5_000L
        private const val MAX_DURATION_MS = 30_000L
    }
}
