package com.ciba.garcia

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.UUID

internal data class GarciaVoiceOption(val id: String, val name: String, val language: String, val offline: Boolean, val quality: Int)

/** Removes visual Markdown syntax before system TTS; the visible message is never modified. */
internal fun speechFriendlyText(source: String): String {
    val text = source
        .replace(Regex("(?s)\\x60\\x60\\x60.*?\\x60\\x60\\x60"), " ")
        .replace(Regex("!\\[([^]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^]]+)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\x60([^\\x60]+)\\x60"), "$1")
        .replace(Regex("(?m)^[ \\t]{0,3}#{1,6}[ \\t]*"), "")
        .replace(Regex("(?m)^[ \\t]*>[ \\t]?"), "")
        .replace(Regex("(?m)^[ \\t]*[-*+][ \\t]+"), "")
        .replace(Regex("(?m)^[ \\t]*\\d+[.)][ \\t]+"), "")
        .replace(Regex("\\*\\*|__|~~|\\*|_"), "")
        .replace(Regex("[()]"), "")
        .replace(Regex("<[^>]+>"), "")
    return text
        .replace(Regex("[ \\t]*\\n[ \\t]*"), ". ")
        .replace(Regex("\\s+"), " ")
        .replace(Regex("([.!?])(?:\\s*[.!?])+"), "$1")
        .replace(Regex(":\\."), ".")
        .trim()
}

/** Android system TTS only. Voice cloning engines are intentionally kept outside this adapter. */
internal class LocalSpeechOutput(
    context: Context,
    private val onAvailabilityChanged: (Boolean, String) -> Unit,
    private val onUtteranceDone: () -> Unit = {},
    private val onUtteranceStarted: () -> Unit = {}
) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)
    private var engine: TextToSpeech? = null
    private var ready = false
    private var closed = false
    private var activeUtteranceId: String? = null
    private var previewRestoreVoiceId: String? = null

    private fun clearLegacyCloneData() {
        listOf(
            java.io.File(appContext.filesDir, "chatterbox-models"),
            java.io.File(appContext.filesDir, "voice-profiles"),
            java.io.File(appContext.cacheDir, "voice-imports")
        ).forEach { directory ->
            runCatching { if (directory.exists()) directory.deleteRecursively() }
        }
        appContext.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
            .edit().clear().apply()
    }

    init {
        clearLegacyCloneData()
        engine = TextToSpeech(appContext) { status ->
            if (closed) return@TextToSpeech
            val tts = engine
            if (status != TextToSpeech.SUCCESS || tts == null) {
                ready = false
                onAvailabilityChanged(false, "Motor de voz do Android indisponível.")
                return@TextToSpeech
            }
            val voices = supportedVoices(tts)
            if (voices.isEmpty()) {
                ready = false
                onAvailabilityChanged(false, "Nenhuma voz em português foi encontrada. Instale vozes nas configurações de texto para fala do Android.")
                return@TextToSpeech
            }
            val preferred = preferences.getString("system_voice_id", null)
                ?: preferences.getString("voice_id", null)?.takeUnless { it.startsWith(LEGACY_CLONE_PREFIX) }
            val chosen = voices.firstOrNull { it.name == preferred }
                ?: voices.firstOrNull { it.locale.country == "BR" && !it.isNetworkConnectionRequired }
                ?: voices.firstOrNull { it.locale.country == "BR" }
                ?: voices.first()
            tts.language = chosen.locale
            tts.voice = chosen
            tts.setSpeechRate(SPEECH_RATE)
            tts.setPitch(1.0f)
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && utteranceId != null && activeUtteranceId == utteranceId) onUtteranceStarted()
                    }
                }
                override fun onDone(utteranceId: String?) {
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && utteranceId != null && activeUtteranceId == utteranceId) {
                            activeUtteranceId = null
                            previewRestoreVoiceId?.let { restore ->
                                previewRestoreVoiceId = null
                                setVoiceInternal(restore)
                            }
                            onUtteranceDone()
                        }
                    }
                }
                override fun onError(utteranceId: String?) {
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && utteranceId != null && activeUtteranceId == utteranceId) {
                            activeUtteranceId = null
                            previewRestoreVoiceId?.let { restore -> previewRestoreVoiceId = null; setVoiceInternal(restore) }
                            onUtteranceDone()
                            onAvailabilityChanged(false, "Falha na reprodução da voz do Android.")
                        }
                    }
                }
            })
            ready = true
            // Migrate any previously selected clone profile back to the available Android voice.
            preferences.edit()
                .putString("voice_mode", "system")
                .putString("voice_id", chosen.name)
                .putString("system_voice_id", chosen.name)
                .remove("cloned_voice_id")
                .apply()
            onAvailabilityChanged(true, statusLabel(chosen))
        }
    }

    private fun supportedVoices(tts: TextToSpeech) =
        tts.voices?.filter { it.locale.language == "pt" && !it.isNetworkConnectionRequired }
            ?.sortedWith(compareByDescending<android.speech.tts.Voice> { it.locale.country == "BR" }
                .thenByDescending { !it.isNetworkConnectionRequired }
                .thenByDescending { it.quality }
                .thenBy { it.name }).orEmpty()

    fun availableVoices(): List<GarciaVoiceOption> =
        (engine?.let(::supportedVoices) ?: emptyList()).map { voice ->
            GarciaVoiceOption(
                voice.name,
                voice.name.replace('_', ' '),
                if (voice.locale.country == "BR") "Português (Brasil)" else "Português (${voice.locale.displayCountry})",
                !voice.isNetworkConnectionRequired,
                voice.quality
            )
        }

    fun selectedVoice(): String? = preferences.getString("voice_id", null)
    fun isSystemReady(): Boolean = ready
    fun isReady(): Boolean = ready

    fun diagnosticStatus(available: Boolean, detail: String): String {
        val voiceName = engine?.voice?.name?.replace('_', ' ')
            ?: preferences.getString("system_voice_id", null)?.replace('_', ' ')
        return if (available && ready) "SYSTEM pronto" + (voiceName?.let { " · $it" } ?: "") +
            if (engine?.voice?.isNetworkConnectionRequired == true) " · requer internet" else " · offline"
        else "SYSTEM indisponível: " + detail.ifBlank { "nenhuma voz local pronta" }
    }

    private fun setVoiceInternal(id: String): Boolean {
        val tts = engine ?: return false
        val voice = supportedVoices(tts).firstOrNull { it.name == id } ?: return false
        val languageResult = tts.setLanguage(voice.locale)
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) return false
        tts.voice = voice
        tts.setSpeechRate(SPEECH_RATE)
        tts.setPitch(1.0f)
        return true
    }

    fun selectVoice(id: String): Boolean {
        if (closed || !ready || !setVoiceInternal(id)) return false
        previewRestoreVoiceId = null
        preferences.edit()
            .putString("voice_mode", "system")
            .putString("voice_id", id)
            .putString("system_voice_id", id)
            .remove("cloned_voice_id")
            .apply()
        onAvailabilityChanged(true, "Voz Android selecionada · " + (availableVoices().firstOrNull { it.id == id }?.name ?: "Português"))
        return true
    }

    /** Preview changes only the temporary TTS voice; the saved selection remains untouched. */
    fun previewVoice(id: String): Boolean {
        if (closed || !ready) return false
        val previous = engine?.voice?.name ?: preferences.getString("system_voice_id", null)
        if (!setVoiceInternal(id)) return false
        previewRestoreVoiceId = previous?.takeIf { it != id }
        return speakSystem("Olá! Eu sou a Garcia. Esta é uma amostra da minha voz. Você pode ouvir outras opções antes de escolher.")
    }

    private fun speakSystem(text: String): Boolean {
        val tts = engine ?: return false
        val cleanText = speechFriendlyText(text)
        if (!ready || closed || cleanText.isBlank()) return false
        val utteranceId = "garcia-system-" + UUID.randomUUID()
        activeUtteranceId = utteranceId
        val result = tts.speak(cleanText.take(MAX_SPOKEN_CHARS), TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (result != TextToSpeech.SUCCESS) {
            activeUtteranceId = null
            previewRestoreVoiceId?.let(::setVoiceInternal)
            previewRestoreVoiceId = null
        }
        return result == TextToSpeech.SUCCESS
    }

    fun speak(text: String): Boolean {
        previewRestoreVoiceId = null
        return speakSystem(text)
    }

    fun stop() {
        activeUtteranceId = null
        previewRestoreVoiceId = null
        engine?.stop()
        preferences.getString("system_voice_id", null)?.let(::setVoiceInternal)
        onUtteranceDone()
    }

    fun shutdown() {
        closed = true
        ready = false
        activeUtteranceId = null
        engine?.stop()
        engine?.shutdown()
        engine = null
    }

    private fun statusLabel(voice: android.speech.tts.Voice) =
        "Resposta por voz pronta · ${voice.name.replace('_', ' ')}" +
            if (voice.isNetworkConnectionRequired) " · requer internet" else " · offline"

    companion object {
        private const val LEGACY_CLONE_PREFIX = "clone:"
        private const val MAX_SPOKEN_CHARS = 8_000
        private const val SPEECH_RATE = 1.15f
    }
}
