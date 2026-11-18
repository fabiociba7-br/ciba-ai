package com.ciba.garcia

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Incremental, on-device speech recognition for continuous conversation.
 * This deliberately uses Android's on-device recognizer only; it never falls
 * back to a network-backed recognition service.
 */
internal class OnDeviceSpeechRecognizer(
    context: Context,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onError: (String, Boolean) -> Unit
) {
    private val appContext = context.applicationContext
    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    val isAvailable: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(appContext)

    fun start(): Boolean {
        if (!isAvailable) {
            onError("Reconhecimento contínuo offline não está disponível neste aparelho.", false)
            return false
        }
        stop()
        return try {
            val engine = SpeechRecognizer.createOnDeviceSpeechRecognizer(appContext)
            recognizer = engine
            engine.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { listening = true }
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() { listening = false }
                override fun onError(error: Int) {
                    listening = false
                    val retry = error == SpeechRecognizer.ERROR_NO_MATCH ||
                        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    val message = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Não detectei fala. Vou ouvir novamente."
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "O reconhecedor de voz está ocupado."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permissão do microfone não concedida."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "O serviço de reconhecimento offline não concluiu a operação."
                        else -> "Falha no reconhecimento de voz (código $error)."
                    }
                    onError(message, retry)
                }
                override fun onResults(results: Bundle?) {
                    listening = false
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (text.isNotBlank()) onFinal(text)
                    else onError("Não foi possível reconhecer essa fala. Vou ouvir novamente.", true)
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (text.isNotBlank()) onPartial(text)
                }
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR")
                putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
            }
            engine.startListening(intent)
            true
        } catch (error: Exception) {
            listening = false
            stop()
            onError(error.message ?: "Não foi possível iniciar o reconhecimento offline.", false)
            false
        }
    }

    fun stop() {
        listening = false
        recognizer?.let { engine ->
            runCatching { engine.cancel() }
            runCatching { engine.destroy() }
        }
        recognizer = null
    }

    fun isListening(): Boolean = listening
}
