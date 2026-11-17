package com.ciba.garcia

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Uses only an installed Android voice explicitly marked as not requiring
 * network connectivity. It never falls back to a cloud voice.
 */
internal class LocalSpeechOutput(
    context: Context,
    private val onAvailabilityChanged: (Boolean, String) -> Unit
) {
    private var engine: TextToSpeech? = null
    private var ready = false
    private var closed = false

    init {
        engine = TextToSpeech(context.applicationContext) { status ->
            if (closed) return@TextToSpeech
            val tts = engine
            if (status != TextToSpeech.SUCCESS || tts == null) {
                ready = false
                onAvailabilityChanged(false, "Motor de voz do Android indisponível.")
                return@TextToSpeech
            }
            val localVoice = tts.voices
                ?.filter { it.locale.language == "pt" && !it.isNetworkConnectionRequired }
                ?.sortedByDescending { it.locale.country == "BR" }
                ?.firstOrNull()
            if (localVoice == null) {
                ready = false
                onAvailabilityChanged(false, "Instale uma voz offline em português nas configurações de texto para fala do Android.")
                return@TextToSpeech
            }
            val languageResult = tts.setLanguage(Locale("pt", "BR"))
            if (languageResult == TextToSpeech.LANG_MISSING_DATA ||
                languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                ready = false
                onAvailabilityChanged(false, "A voz offline em português não é compatível com este aparelho.")
                return@TextToSpeech
            }
            tts.voice = localVoice
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) = Unit
                override fun onError(utteranceId: String?) {
                    onAvailabilityChanged(false, "Falha na reprodução da resposta por voz.")
                }
            })
            ready = true
            onAvailabilityChanged(true, "Resposta por voz local pronta · " + localVoice.name)
        }
    }

    fun isReady(): Boolean = ready

    fun speak(text: String): Boolean {
        val tts = engine ?: return false
        if (!ready || closed || text.isBlank()) return false
        val safeText = text.take(MAX_SPOKEN_CHARS)
        return tts.speak(safeText, TextToSpeech.QUEUE_FLUSH, null, "garcia-" + System.currentTimeMillis()) == TextToSpeech.SUCCESS
    }

    fun stop() {
        engine?.stop()
    }

    fun shutdown() {
        closed = true
        ready = false
        engine?.stop()
        engine?.shutdown()
        engine = null
    }

    companion object {
        private const val MAX_SPOKEN_CHARS = 8_000
    }
}
