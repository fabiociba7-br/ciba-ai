package com.ciba.garcia

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

internal data class GarciaVoiceProfile(
    val id: String,
    val name: String,
    val sample: File,
    val wav: File,
    val createdAt: Long,
    val durationMs: Long,
    val sampleSha256: String,
    val wavSha256: String,
    val integrityValid: Boolean = true
)

internal class VoiceProfileStore(context: Context) {
    private val app = context.applicationContext
    private val root = File(app.filesDir, "voice-profiles").apply { mkdirs() }
    private val imports = File(app.cacheDir, "voice-imports").apply { mkdirs() }
    private val prefs = app.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
    private val voicePrefs = app.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)

    fun importAudio(uri: Uri): File {
        val target = File(imports, "reference-${UUID.randomUUID()}.audio")
        try {
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
            validateAudio(target)
            return target
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }

    fun saveRecording(source: File): File {
        validateAudio(source)
        val target = File(imports, "recording-${UUID.randomUUID()}.m4a")
        try {
            source.copyTo(target, overwrite = true)
            validateAudio(target)
            return target
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }

    fun save(source: File, name: String, normalizedWav: File): GarciaVoiceProfile {
        require(name.isNotBlank() && name.trim().length <= 40) { "Digite um nome de até 40 caracteres para o perfil." }
        val duration = validateAudio(source)
        validateNormalizedWav(normalizedWav)
        val id = UUID.randomUUID().toString()
        val directory = File(root, id)
        check(directory.mkdirs()) { "Não foi possível criar o perfil de voz." }
        val extension = source.extension.lowercase().filter { it.isLetterOrDigit() }.take(8).ifBlank { "audio" }
        val sample = File(directory, "reference.$extension")
        val wav = File(directory, "reference.wav")
        var saved = false
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
            verifiedProfiles[sample.absolutePath] = ProfileStamp(sample.length(), sample.lastModified(), sampleHash)
            verifiedProfiles[wav.absolutePath] = ProfileStamp(wav.length(), wav.lastModified(), wavHash)
            saved = true
            return profile
        } catch (error: Throwable) {
            directory.deleteRecursively()
            throw error
        } finally {
            if (saved && isInside(imports, source)) source.delete()
            if (saved && isInside(app.cacheDir, normalizedWav)) normalizedWav.delete()
        }
    }

    /**
     * Loads profiles and performs safe, local migrations for older records.
     * Missing legacy hashes are calculated from the files; an existing hash
     * mismatch is never silently accepted. If the original sample is intact,
     * a missing/corrupt normalized WAV is rebuilt from that sample.
     */
    fun profiles(): List<GarciaVoiceProfile> {
        val json = runCatching { JSONObject(prefs.getString("profiles_json", "{}").orEmpty()) }
            .getOrElse { JSONObject() }
        val result = mutableListOf<GarciaVoiceProfile>()
        val keys = json.keys()
        var metadataChanged = false

        while (keys.hasNext()) {
            val id = keys.next()
            val item = json.optJSONObject(id) ?: continue
            val directory = File(root, id)
            if (!isInside(root, directory)) continue

            val sampleName = item.optString("sample").ifBlank { "reference.m4a" }
            val wavName = item.optString("wav").ifBlank { "reference.wav" }
            var sample = File(directory, sampleName)
            var wav = File(directory, wavName)
            if (!isInside(root, sample) || !isInside(root, wav)) continue

            var sampleHash = item.optString("sample_sha256")
            var wavHash = item.optString("wav_sha256")
            var duration = item.optLong("duration_ms", 0L)

            // A legacy profile may have files but no checksum metadata.
            // Hashes are initialized only when absent, never when mismatched.
            if (sample.isFile && sampleHash.isBlank()) {
                sampleHash = runCatching { sha256(sample) }.getOrDefault("")
                if (sampleHash.isNotBlank()) {
                    item.put("sample_sha256", sampleHash)
                    metadataChanged = true
                }
            }

            val sampleTrusted = sample.isFile && sampleHash.isNotBlank() &&
                verified(sample, sampleHash)

            // If the original recording is intact, rebuild a missing or
            // damaged normalized WAV so older profiles can be recovered.
            if (sampleTrusted && (!wav.isFile || (wavHash.isNotBlank() && !verified(wav, wavHash)) || runCatching { validateNormalizedWav(wav) }.isFailure)) {
                runCatching {
                    val rebuilt = File(directory, "reference.wav")
                    val temp = File(directory, "reference-repair-${UUID.randomUUID()}.wav")
                    try {
                        VoiceAudioNormalizer.toMonoWav(sample, temp)
                        validateNormalizedWav(temp)
                        check(temp.renameTo(rebuilt) || (temp.copyTo(rebuilt, overwrite = true).exists() && temp.delete())) {
                            "Não foi possível restaurar a referência WAV."
                        }
                    } finally {
                        temp.delete()
                    }
                    wav = rebuilt
                    item.put("wav", wav.name)
                    wavHash = sha256(wav)
                    item.put("wav_sha256", wavHash)
                    metadataChanged = true
                }
            }

            // If only the normalized WAV survived, restore a playable sample
            // copy. This does not override an existing checksum mismatch.
            if (!sample.isFile && wav.isFile) {
                val wavTrusted = wavHash.isBlank() || verified(wav, wavHash)
                if (wavTrusted) {
                    runCatching {
                        sample = File(directory, "reference.wav")
                        if (sample.canonicalFile != wav.canonicalFile) wav.copyTo(sample, overwrite = true)
                        item.put("sample", sample.name)
                        sampleHash = sha256(sample)
                        item.put("sample_sha256", sampleHash)
                        metadataChanged = true
                    }
                }
            }

            if (wav.isFile && wavHash.isBlank()) {
                wavHash = runCatching { sha256(wav) }.getOrDefault("")
                if (wavHash.isNotBlank()) {
                    item.put("wav_sha256", wavHash)
                    metadataChanged = true
                }
            }
            if (duration <= 0L && sample.isFile) {
                duration = runCatching { validateAudio(sample) }.getOrDefault(0L)
                if (duration > 0L) {
                    item.put("duration_ms", duration)
                    metadataChanged = true
                }
            }

            val hashesValid = sample.isFile && wav.isFile &&
                sampleHash.isNotBlank() && wavHash.isNotBlank() &&
                verified(sample, sampleHash) && verified(wav, wavHash) &&
                runCatching { validateNormalizedWav(wav) }.isSuccess

            result += GarciaVoiceProfile(
                id = id,
                name = item.optString("name", "Minha voz").ifBlank { "Minha voz" },
                sample = sample,
                wav = wav,
                createdAt = item.optLong("created_at", 0L),
                durationMs = duration,
                sampleSha256 = sampleHash,
                wavSha256 = wavHash,
                integrityValid = hashesValid
            )
        }

        if (metadataChanged) {
            check(prefs.edit().putString("profiles_json", json.toString()).commit()) {
                "Não foi possível atualizar os dados de integridade dos perfis de voz."
            }
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

    fun currentProfile(): GarciaVoiceProfile? = activeProfileId()?.let { id -> profiles().firstOrNull { it.id == id && it.integrityValid } }
    fun currentFile(): File? = currentProfile()?.sample
    fun currentWav(): File? = currentProfile()?.wav
    fun currentName(): String = currentProfile()?.name.orEmpty()

    fun select(profile: GarciaVoiceProfile) {
        require(profile.integrityValid && isInside(root, profile.sample) && isInside(root, profile.wav) && profile.sample.isFile && profile.wav.isFile) { "O perfil de voz não passou na verificação SHA-256 ou não está no armazenamento privado da Garcia." }
        val currentVoice = voicePrefs.getString("voice_id", null) ?: voicePrefs.getString("system_voice_id", null)
        val editor = voicePrefs.edit()
            .putString("voice_mode", "cloned")
            .putString("cloned_voice_id", profile.id)
            .putString("voice_id", "clone:" + profile.id)
        if (!currentVoice.isNullOrBlank() && !currentVoice.startsWith("clone:")) editor.putString("system_voice_id", currentVoice)
        check(editor.commit()) { "Não foi possível ativar o perfil de voz." }
        prefs.edit().putString("active_profile_id", profile.id).apply()
    }

    fun rename(profileId: String, newName: String) {
        require(newName.isNotBlank() && newName.trim().length <= 40) { "Digite um nome de até 40 caracteres para o perfil." }
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        val item = json.optJSONObject(profileId) ?: error("Perfil não encontrado.")
        item.put("name", newName.trim())
        json.put(profileId, item)
        check(prefs.edit().putString("profiles_json", json.toString()).commit()) { "Não foi possível renomear o perfil." }
    }

    fun delete(profileId: String) {
        val wasActive = activeProfileId() == profileId
        val directory = File(root, profileId)
        if (isInside(root, directory)) check(!directory.exists() || directory.deleteRecursively()) {
            "Não foi possível apagar os arquivos locais do perfil."
        }
        val json = JSONObject(prefs.getString("profiles_json", "{}").orEmpty())
        json.remove(profileId)
        val profileEditor = prefs.edit().putString("profiles_json", json.toString())
        if (prefs.getString("active_profile_id", null) == profileId) profileEditor.remove("active_profile_id")
        check(profileEditor.commit()) { "Não foi possível atualizar os perfis salvos." }
        if (wasActive) {
            val systemVoice = voicePrefs.getString("system_voice_id", null)
            val editor = voicePrefs.edit()
                .putString("voice_mode", "system")
                .remove("cloned_voice_id")
                .remove("system_voice_id")
            if (systemVoice.isNullOrBlank()) editor.remove("voice_id") else editor.putString("voice_id", systemVoice)
            check(editor.commit()) { "Não foi possível restaurar a voz do sistema." }
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
            val dataBytes = file.length() - 44L
            require(dataBytes > 0L && dataBytes % 2L == 0L && data.getInt(40).toLong() == dataBytes) {
                "O WAV normalizado está incompleto ou corrompido."
            }
            val sampleCount = dataBytes / 2L
            val durationMs = sampleCount * 1_000L / 24_000L
            require(durationMs in MIN_DURATION_MS..MAX_DURATION_MS) {
                "A referência normalizada precisa ter entre 5 e 30 segundos."
            }
            wav.seek(44L)
            var sumSquares = 0.0
            var peak = 0
            var clipped = 0L
            var count = 0L
            while (wav.filePointer + 1L < wav.length()) {
                val raw = wav.readUnsignedByte() or (wav.readUnsignedByte() shl 8)
                val sample = if (raw >= 32_768) raw - 65_536 else raw
                val magnitude = kotlin.math.abs(sample)
                peak = maxOf(peak, magnitude)
                if (magnitude >= 32_700) clipped++
                sumSquares += sample.toDouble() * sample.toDouble()
                count++
            }
            require(count > 0L) { "A gravação não contém amostras de áudio." }
            val rms = kotlin.math.sqrt(sumSquares / count) / 32_768.0
            require(peak > 0 && rms >= 0.003) {
                "A referência está silenciosa ou com volume muito baixo. Grave novamente mais perto do microfone."
            }
            require(clipped.toDouble() / count.toDouble() <= 0.05 && rms <= 0.5) {
                "A referência está muito distorcida ou saturada. Reduza o volume e grave novamente."
            }
        }
    }

    private fun verified(file: File, expected: String): Boolean {
        val stamp = ProfileStamp(file.length(), file.lastModified(), expected)
        if (verifiedProfiles[file.absolutePath] == stamp) return true
        val matches = runCatching { sha256(file) == expected }.getOrDefault(false)
        if (matches) verifiedProfiles[file.absolutePath] = stamp else verifiedProfiles.remove(file.absolutePath)
        return matches
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

    private data class ProfileStamp(val length: Long, val modified: Long, val checksum: String)

    companion object {
        private val verifiedProfiles = ConcurrentHashMap<String, ProfileStamp>()
        private const val MAX_AUDIO_BYTES = 50L * 1024 * 1024
        private const val MIN_DURATION_MS = 5_000L
        private const val MAX_DURATION_MS = 30_000L
    }
}
