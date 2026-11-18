package com.ciba.garcia

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.os.Handler
import android.os.Looper

internal data class GarciaVoiceOption(val id: String, val name: String, val language: String, val offline: Boolean, val quality: Int)

/**
 * Removes visual Markdown syntax before text is sent to Android TTS.
 * The visible chat message is never modified.
 */
internal fun speechFriendlyText(source: String): String {
    var text = source
        .replace(Regex("(?s)```.*?```"), " ")
        .replace(Regex("!\\[([^]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^]]+)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("`([^`]+)`"), "$1")
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

/** Android TTS voice selector. Preview never changes the saved voice. */
internal class LocalSpeechOutput(context: Context, private val onAvailabilityChanged: (Boolean, String) -> Unit, private val onUtteranceDone: () -> Unit = {}, private val onUtteranceStarted: () -> Unit = {}) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)
    private var engine: TextToSpeech? = null
    private var ready = false
    private var closed = false
    private var activeUtteranceId: String? = null
    private var selectedVoiceId: String? = preferences.getString("voice_id", null)
    private var previewRestoreVoiceId: String? = null

    init {
        ClonedVoiceRuntime.restore(appContext)
        engine = TextToSpeech(appContext) { status ->
            if (closed) return@TextToSpeech
            val tts = engine
            if (status != TextToSpeech.SUCCESS || tts == null) {
                ready = false
                val cloneAvailable = clonedVoiceAvailable()
                onAvailabilityChanged(cloneAvailable, if (cloneAvailable) "Voz clonada disponível; Android TTS indisponível." else "Motor de voz do Android indisponível.")
                return@TextToSpeech
            }
            val voices = supportedVoices(tts)
            if (voices.isEmpty()) {
                ready = false
                val cloneAvailable = clonedVoiceAvailable()
                onAvailabilityChanged(cloneAvailable, if (cloneAvailable) "Voz clonada disponível; nenhuma voz portuguesa do Android foi encontrada." else "Nenhuma voz em português foi encontrada. Instale vozes nas configurações de texto para fala do Android.")
                return@TextToSpeech
            }
            val chosen = voices.firstOrNull { it.name == selectedVoiceId } ?: voices.firstOrNull { it.locale.country == "BR" && !it.isNetworkConnectionRequired } ?: voices.firstOrNull { it.locale.country == "BR" } ?: voices.first()
            tts.language = chosen.locale
            tts.voice = chosen
            tts.setSpeechRate(SPEECH_RATE)
            tts.setPitch(1.0f)
            selectedVoiceId = chosen.name
            preferences.edit().putString("voice_id", chosen.name).apply()
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) { Handler(Looper.getMainLooper()).post { if (!closed && utteranceId != null && activeUtteranceId == utteranceId) onUtteranceStarted() } }
                override fun onDone(utteranceId: String?) { Handler(Looper.getMainLooper()).post { if (!closed && utteranceId != null && activeUtteranceId == utteranceId) { activeUtteranceId = null; previewRestoreVoiceId?.let { restore -> previewRestoreVoiceId = null; setVoiceInternal(restore) }; onUtteranceDone() } } }
                override fun onError(utteranceId: String?) { Handler(Looper.getMainLooper()).post { if (!closed && utteranceId != null && activeUtteranceId == utteranceId) { activeUtteranceId = null; previewRestoreVoiceId = null; onUtteranceDone(); onAvailabilityChanged(false, "Falha na reprodução da resposta por voz.") } } }
            })
            ready = true
            onAvailabilityChanged(
                true,
                if (clonedVoiceAvailable()) "Voz clonada selecionada para as respostas; voz Android disponível como reserva."
                else statusLabel(chosen)
            )
        }
    }

    private fun clonedVoiceAvailable(): Boolean =
        ClonedVoiceRuntime.hasActiveProfile(appContext) && ChatterboxModelManager.installed(appContext) != null

    private fun supportedVoices(tts: TextToSpeech) = tts.voices?.filter { it.locale.language == "pt" }?.sortedWith(compareByDescending<android.speech.tts.Voice> { it.locale.country == "BR" }.thenByDescending { !it.isNetworkConnectionRequired }.thenByDescending { it.quality }.thenBy { it.name }).orEmpty()

    fun availableVoices(): List<GarciaVoiceOption> = (engine?.let(::supportedVoices) ?: emptyList()).map { voice -> GarciaVoiceOption(voice.name, voice.name.replace('_', ' '), if (voice.locale.country == "BR") "Português (Brasil)" else "Português (${voice.locale.displayCountry})", !voice.isNetworkConnectionRequired, voice.quality) }
    fun selectedVoice(): String? = selectedVoiceId

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
        if (!ready || closed || !setVoiceInternal(id)) return false
        selectedVoiceId = id
        previewRestoreVoiceId = null
        preferences.edit().putString("voice_id", id).apply()
        onAvailabilityChanged(
            true,
            if (clonedVoiceAvailable()) "Voz Android definida como reserva; o perfil clonado continua sendo a voz principal."
            else "Voz selecionada · " + (availableVoices().firstOrNull { it.id == id }?.name ?: "Português")
        )
        return true
    }

    fun previewVoice(id: String): Boolean {
        if (!ready || closed) return false
        val previous = selectedVoiceId ?: return false
        if (!setVoiceInternal(id)) return false
        previewRestoreVoiceId = previous
        return speakInternal("Olá! Eu sou a Garcia. Esta é uma amostra da minha voz. Você pode ouvir outras opções antes de escolher.")
    }

    fun isReady(): Boolean = ready
    private fun speakInternal(text: String): Boolean {
        val tts = engine ?: return false
        val cleanText = speechFriendlyText(text)
        if (!ready || closed || cleanText.isBlank()) return false
        val utteranceId = "garcia-" + System.nanoTime()
        activeUtteranceId = utteranceId
        val result = tts.speak(cleanText.take(MAX_SPOKEN_CHARS), TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (result != TextToSpeech.SUCCESS) { activeUtteranceId = null; previewRestoreVoiceId = null }
        return result == TextToSpeech.SUCCESS
    }
    fun speak(text: String): Boolean {
        previewRestoreVoiceId = null
        val cleanText = speechFriendlyText(text).take(MAX_SPOKEN_CHARS)
        if (cleanText.isBlank() || closed) return false
        if (ClonedVoiceRuntime.hasActiveProfile(appContext)) {
            val utteranceId = "garcia-clone-" + System.nanoTime()
            activeUtteranceId = utteranceId
            ClonedVoiceRuntime.speak(
                appContext,
                cleanText,
                onStarted = {
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && activeUtteranceId == utteranceId) onUtteranceStarted()
                    }
                },
                onDone = {
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && activeUtteranceId == utteranceId) {
                            activeUtteranceId = null
                            onUtteranceDone()
                        }
                    }
                },
                onError = { error ->
                    Handler(Looper.getMainLooper()).post {
                        if (!closed && activeUtteranceId == utteranceId) {
                            activeUtteranceId = null
                            val fallbackStarted = ready && speakInternal(cleanText)
                            if (fallbackStarted) {
                                onAvailabilityChanged(true, "A voz clonada falhou nesta resposta; usando temporariamente a voz padrão do Android.")
                            } else {
                                onUtteranceDone()
                                onAvailabilityChanged(false, "Falha na voz clonada: " + (error.message ?: "erro desconhecido"))
                            }
                        }
                    }
                }
            )
            return true
        }
        return speakInternal(cleanText)
    }
    fun stop() {
        activeUtteranceId = null
        previewRestoreVoiceId = null
        ClonedVoiceRuntime.stop()
        onUtteranceDone()
        engine?.stop()
        selectedVoiceId?.let(::setVoiceInternal)
    }
    fun shutdown() { closed = true; ready = false; activeUtteranceId = null; engine?.stop(); engine?.shutdown(); engine = null }
    private fun statusLabel(voice: android.speech.tts.Voice) = "Resposta por voz pronta · ${voice.name.replace('_', ' ')}" + if (voice.isNetworkConnectionRequired) " · requer internet" else " · offline"
    companion object {
        private const val MAX_SPOKEN_CHARS = 8_000
        private const val SPEECH_RATE = 1.15f
    }
}
