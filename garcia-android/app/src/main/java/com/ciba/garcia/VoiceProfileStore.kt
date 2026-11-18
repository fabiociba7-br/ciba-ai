package com.ciba.garcia

import android.content.Context
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
    private val prefs = app.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)

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
