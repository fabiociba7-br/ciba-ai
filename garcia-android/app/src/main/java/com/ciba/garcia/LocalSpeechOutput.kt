package com.ciba.garcia

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

internal data class GarciaVoiceOption(val id: String, val name: String, val language: String, val offline: Boolean, val quality: Int)

/** Removes visual Markdown syntax before system TTS; the visible message is never modified. */
internal fun speechFriendlyText(source: String): String {
    val text = source
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

/**
 * Keeps Android TTS and local cloned speech as separate, explicit modes.
 * CLONED never silently falls back to SYSTEM when the model/runtime fails.
 */
internal class LocalSpeechOutput(
    context: Context,
    private val onAvailabilityChanged: (Boolean, String) -> Unit,
    private val onUtteranceDone: () -> Unit = {},
    private val onUtteranceStarted: () -> Unit = {}
) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)
    private val profileStore = VoiceProfileStore(appContext)
    private var engine: TextToSpeech? = null
    private var ready = false
    private var closed = false
    private var activeUtteranceId: String? = null
    private var previewRestoreVoiceId: String? = null

    init {
        engine = TextToSpeech(appContext) { status ->
            if (closed) return@TextToSpeech
            val tts = engine
            if (status != TextToSpeech.SUCCESS || tts == null) {
                ready = false
                if (isCloneMode()) restoreCloneMode()
                else onAvailabilityChanged(false, "Motor de voz do Android indisponível.")
                return@TextToSpeech
            }
            val voices = supportedVoices(tts)
            if (voices.isEmpty()) {
                ready = false
                if (isCloneMode()) restoreCloneMode()
                else onAvailabilityChanged(false, "Nenhuma voz em português foi encontrada. Instale vozes nas configurações de texto para fala do Android.")
                return@TextToSpeech
            }
            val preferred = preferences.getString("system_voice_id", null)
                ?: preferences.getString("voice_id", null)?.takeUnless { it.startsWith(CLONE_PREFIX) }
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
            if (isCloneMode()) restoreCloneMode()
            else {
                if (preferences.getString("voice_id", null).isNullOrBlank()) {
                    preferences.edit().putString("voice_id", chosen.name).putString("system_voice_id", chosen.name).apply()
                }
                onAvailabilityChanged(true, statusLabel(chosen))
            }
        }
    }

    private fun isCloneMode(): Boolean =
        preferences.getString("voice_mode", "system") == "cloned" ||
            preferences.getString("voice_id", null)?.startsWith(CLONE_PREFIX) == true

    private fun restoreCloneMode() {
        if (!ChatterboxVoiceCloneEngine.isAvailable(appContext)) {
            onAvailabilityChanged(false, "A voz clonada está selecionada, mas o runtime ou os modelos locais não estão disponíveis. Instale os modelos em Configurações > Clonar minha voz. A Garcia não trocará para outra voz automaticamente.")
            return
        }
        ChatterboxVoiceCloneEngine.restore(appContext) { result ->
            Handler(Looper.getMainLooper()).post {
                if (closed) return@post
                result.fold(
                    { onAvailabilityChanged(true, "Voz clonada local pronta para as respostas da Garcia.") },
                    { onAvailabilityChanged(false, "Não foi possível carregar a voz clonada: " + safeMessage(it) + ". Nenhuma voz substituta será usada.") }
                )
            }
        }
    }

    private fun supportedVoices(tts: TextToSpeech) =
        tts.voices?.filter { it.locale.language == "pt" }
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
    fun isCloneEngineAvailable(): Boolean = ChatterboxVoiceCloneEngine.isAvailable(appContext)
    fun isCloneSelected(): Boolean = isCloneMode()
    fun isReady(): Boolean = if (isCloneMode()) isCloneEngineAvailable() && profileStore.currentProfile() != null else ready

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
        ChatterboxVoiceCloneEngine.release()
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

    /** Preview changes only the temporary TTS voice; saved mode/profile remain untouched. */
    fun previewVoice(id: String): Boolean {
        if (closed || !ready) return false
        val previous = engine?.voice?.name ?: preferences.getString("system_voice_id", null)
        if (!setVoiceInternal(id)) return false
        previewRestoreVoiceId = previous?.takeIf { it != id }
        return speakSystem("Olá! Eu sou a Garcia. Esta é uma amostra da minha voz. Você pode ouvir outras opções antes de escolher.")
    }

    fun selectClonedProfile(profile: GarciaVoiceProfile, onResult: (Result<Unit>) -> Unit = {}): Boolean {
        if (closed || !ChatterboxVoiceCloneEngine.isAvailable(appContext)) {
            val error = IllegalStateException("Instale e valide os modelos locais Chatterbox antes de ativar a voz clonada.")
            onAvailabilityChanged(false, error.message ?: "Motor de clonagem indisponível.")
            onResult(Result.failure(error))
            return false
        }
        return runCatching {
            profileStore.select(profile)
            ChatterboxVoiceCloneEngine.activate(appContext, profile) { result ->
                Handler(Looper.getMainLooper()).post {
                    result.fold(
                        { onAvailabilityChanged(true, "Voz clonada '${profile.name}' pronta. As respostas faladas usarão este perfil local.") },
                        { onAvailabilityChanged(false, "Falha ao ativar a voz clonada: " + safeMessage(it) + ". Sem fallback automático.") }
                    )
                    onResult(result)
                }
            }
            true
        }.getOrElse {
            onAvailabilityChanged(false, safeMessage(it))
            onResult(Result.failure(it))
            false
        }
    }

    /** Preview uses the supplied profile without changing the active selection. */
    fun previewClonedProfile(profile: GarciaVoiceProfile, onResult: (Result<Unit>) -> Unit = {}): Boolean {
        if (closed || !ChatterboxVoiceCloneEngine.isAvailable(appContext)) {
            onResult(Result.failure(IllegalStateException("Instale os modelos locais Chatterbox antes de ouvir a voz clonada.")))
            return false
        }
        ChatterboxVoiceCloneEngine.preview(
            appContext,
            profile,
            "Olá! Eu sou a Garcia. Esta é uma amostra da voz clonada que você escolheu para mim."
        ) { result ->
            Handler(Looper.getMainLooper()).post {
                if (result.isFailure) onAvailabilityChanged(isReady(), "Falha na prévia da voz clonada: " + safeMessage(result.exceptionOrNull()!!))
                onResult(result)
            }
        }
        return true
    }

    fun onProfileDeleted(profileId: String, wasActive: Boolean) {
        if (!wasActive) return
        ChatterboxVoiceCloneEngine.release()
        val restored = preferences.getString("voice_id", null)
        if (ready && !restored.isNullOrBlank()) setVoiceInternal(restored)
        onAvailabilityChanged(ready, if (ready) "Perfil removido. Voz do sistema restaurada." else "Perfil removido. Instale uma voz do Android para voltar a ouvir respostas.")
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
            previewRestoreVoiceId = null
        }
        return result == TextToSpeech.SUCCESS
    }

    fun speak(text: String): Boolean {
        previewRestoreVoiceId = null
        val cleanText = speechFriendlyText(text).take(MAX_SPOKEN_CHARS)
        if (cleanText.isBlank() || closed) return false
        if (isCloneMode()) {
            val profile = profileStore.currentProfile()
            if (profile == null) {
                onAvailabilityChanged(false, "A voz clonada está selecionada, mas o perfil local não existe ou falhou na verificação SHA-256. Reimporte a gravação. Nenhuma voz substituta será usada.")
                return false
            }
            if (!ChatterboxVoiceCloneEngine.isAvailable(appContext)) {
                onAvailabilityChanged(false, "A voz clonada está selecionada, mas o runtime ou os modelos locais não estão disponíveis. A resposta não será enviada ao TTS do sistema.")
                return false
            }
            val utteranceId = "garcia-clone-" + System.nanoTime()
            activeUtteranceId = utteranceId
            ChatterboxVoiceCloneEngine.speak(
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
                            onUtteranceDone()
                            onAvailabilityChanged(false, "Falha na voz clonada: " + safeMessage(error) + ". Não houve substituição por outra voz.")
                        }
                    }
                }
            )
            return true
        }
        return speakSystem(cleanText)
    }

    fun stop() {
        activeUtteranceId = null
        previewRestoreVoiceId = null
        ChatterboxVoiceCloneEngine.stop()
        engine?.stop()
        if (!isCloneMode()) preferences.getString("system_voice_id", null)?.let(::setVoiceInternal)
        onUtteranceDone()
    }

    fun shutdown() {
        closed = true
        ready = false
        activeUtteranceId = null
        engine?.stop()
        engine?.shutdown()
        engine = null
        ChatterboxVoiceCloneEngine.release()
    }

    private fun statusLabel(voice: android.speech.tts.Voice) =
        "Resposta por voz pronta · ${voice.name.replace('_', ' ')}" +
            if (voice.isNetworkConnectionRequired) " · requer internet" else " · offline"

    private fun safeMessage(error: Throwable): String =
        (error.message ?: error.javaClass.simpleName)
            .replace(Regex("/(?:data|storage|mnt)/[^\\s]+"), "[arquivo local]")
            .take(300)

    companion object {
        private const val CLONE_PREFIX = "clone:"
        private const val MAX_SPOKEN_CHARS = 8_000
        private const val SPEECH_RATE = 1.15f
    }
}
