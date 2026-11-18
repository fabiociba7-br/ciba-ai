package com.ciba.garcia

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.FileOutputStream
import org.json.JSONObject
import java.io.File
import java.util.UUID

internal data class GarciaVoiceProfile(
    val id: String,
    val name: String,
    val sample: File,
    val wav: File
)

internal class VoiceProfileStore(context: Context) {
    private val app = context.applicationContext
    private val root = File(app.filesDir, "voice-profiles").apply { mkdirs() }
    private val references = File(app.filesDir, "voice-references").apply { mkdirs() }
    private val prefs = app.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)


    fun import(uri: Uri): File {
        val displayName = app.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }.orEmpty()
        val extension = displayName.substringAfterLast(".", "m4a").lowercase()
            .filter { it.isLetterOrDigit() }.take(8).ifBlank { "m4a" }
        val target = File(references, "reference-" + UUID.randomUUID() + "." + extension)
        app.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(target).use { output -> input.copyTo(output) }
        } ?: error("Não foi possível abrir o áudio selecionado.")
        validate(target)
        return target
    }

    fun saveRecording(source: File): File {
        validate(source)
        val target = File(references, "reference-" + UUID.randomUUID() + ".m4a")
        source.copyTo(target, overwrite = true)
        validate(target)
        return target
    }

    private fun validate(file: File) {
        require(file.isFile && file.length() > 1024) { "O arquivo de áudio está vazio ou inválido." }
        require(file.length() <= 50L * 1024 * 1024) { "O áudio deve ter no máximo 50 MB." }
        val metadata = MediaMetadataRetriever()
        try {
            metadata.setDataSource(file.absolutePath)
            require(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes") {
                "O arquivo selecionado não contém uma faixa de áudio."
            }
            val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            require(duration in 5_000L..120_000L) {
                "Use uma gravação entre 5 segundos e 2 minutos. O ideal para a clonagem é 10 a 15 segundos de fala limpa."
            }
        } finally { metadata.release() }
    }

    fun profiles(): List<GarciaVoiceProfile> {
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        val result = mutableListOf<GarciaVoiceProfile>()
        val keys = json.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val item = json.optJSONObject(id) ?: continue
            val sample = File(item.optString("sample"))
            val wav = File(item.optString("wav"))
            if (sample.isFile && wav.isFile) {
                result += GarciaVoiceProfile(id, item.optString("name", "Minha voz"), sample, wav)
            }
        }
        return result.sortedBy { it.name.lowercase() }
    }

    fun activeProfileId(): String? = prefs.getString("active_profile_id", null)
    fun currentProfile(): GarciaVoiceProfile? = profiles().firstOrNull { it.id == activeProfileId() }
    fun currentFile(): File? = currentProfile()?.sample
    fun currentWav(): File? = currentProfile()?.wav
    fun currentName(): String = currentProfile()?.name.orEmpty()

    fun save(source: File, name: String, normalizedWav: File): GarciaVoiceProfile {
        require(name.isNotBlank()) { "Digite um nome para o perfil." }
        val id = UUID.randomUUID().toString()
        val directory = File(root, id).apply { mkdirs() }
        val extension = source.extension.lowercase().filter { it.isLetterOrDigit() }.take(8).ifBlank { "audio" }
        val savedSample = File(directory, "reference." + extension)
        val savedWav = File(directory, "reference.wav")
        source.copyTo(savedSample, overwrite = true)
        normalizedWav.copyTo(savedWav, overwrite = true)
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        json.put(id, JSONObject()
            .put("name", name.trim())
            .put("sample", savedSample.absolutePath)
            .put("wav", savedWav.absolutePath))
        prefs.edit().putString("profiles_json", json.toString()).apply()
        val profile = GarciaVoiceProfile(id, name.trim(), savedSample, savedWav)
        select(profile)
        return profile
    }

    fun select(profile: GarciaVoiceProfile) {
        prefs.edit()
            .putString("active_profile_id", profile.id)
            .putString("active_sample", profile.sample.absolutePath)
            .putString("active_wav", profile.wav.absolutePath)
            .putString("active_name", profile.name)
            .apply()
    }

    fun rename(profileId: String, newName: String) {
        require(newName.isNotBlank()) { "Digite um nome para o perfil." }
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        val item = json.optJSONObject(profileId) ?: error("Perfil não encontrado.")
        item.put("name", newName.trim())
        json.put(profileId, item)
        val edit = prefs.edit().putString("profiles_json", json.toString())
        if (activeProfileId() == profileId) edit.putString("active_name", newName.trim())
        edit.apply()
    }

    fun delete(profileId: String) {
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        val item = json.optJSONObject(profileId)
        val profileDir = item?.optString("sample")?.let(::File)?.parentFile
        json.remove(profileId)
        val edit = prefs.edit().putString("profiles_json", json.toString())
        if (activeProfileId() == profileId) {
            edit.remove("active_profile_id").remove("active_sample").remove("active_wav").remove("active_name")
        }
        edit.apply()
        profileDir?.deleteRecursively()
    }
}
