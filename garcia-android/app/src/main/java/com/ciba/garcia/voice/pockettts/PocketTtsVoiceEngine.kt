package com.ciba.garcia.voice.pockettts

import android.os.Build
import com.ciba.garcia.voice.EngineResult
import com.ciba.garcia.voice.SpeechRequest
import com.ciba.garcia.voice.SpeechResult
import com.ciba.garcia.voice.VoiceEngine
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Adapter between Garcia's VoiceEngine contract and the embedded Pocket TTS JNI runtime.
 *
 * The caller supplies paths from Garcia's private model/profile store. No Android
 * companion package, system TTS provider, or external app is involved.
 */
internal class PocketTtsVoiceEngine(
    private val modelsDirectory: File,
    private val voicesDirectory: File,
    private val defaultVoiceFile: File,
    private val precision: String = "fp32",
    private val temperature: Float = 0.5f,
    private val lsdSteps: Int = 1,
    private val threads: Int = 2,
    private val sentencePauseMs: Int = 250,
    private val maxTextTokens: Int = 50
) : VoiceEngine {
    override val id: String = "pocket-tts"

    @Volatile
    private var native: NativePocketTts? = null

    override suspend fun initialize(): EngineResult = withContext(Dispatchers.IO) {
        if (Build.SUPPORTED_ABIS.none { it == "arm64-v8a" }) {
            return@withContext EngineResult.Unavailable("Pocket TTS requer Android ARM64 (arm64-v8a).")
        }
        if (precision != "fp32" && precision != "int8") {
            return@withContext EngineResult.Unavailable("Precisão de modelo não suportada: $precision.")
        }
        val required = buildList {
            add("mimi_encoder.onnx")
            add("text_conditioner.onnx")
            add("tokenizer.model")
            if (precision == "int8") {
                add("flow_lm_main_int8.onnx")
                add("flow_lm_flow_int8.onnx")
                add("mimi_decoder_int8.onnx")
            } else {
                add("flow_lm_main.onnx")
                add("flow_lm_flow.onnx")
                add("mimi_decoder.onnx")
            }
        }
        val missing = required.filterNot { File(modelsDirectory, it).isFile }
        if (missing.isNotEmpty()) {
            return@withContext EngineResult.Unavailable(
                "Pacote Pocket TTS incompleto. Arquivos ausentes: ${missing.joinToString()}"
            )
        }
        if (!voicesDirectory.isDirectory || !defaultVoiceFile.isFile) {
            return@withContext EngineResult.Unavailable("Nenhuma voz padrão válida foi encontrada no armazenamento privado.")
        }
        try {
            native?.close()
            native = NativePocketTts(
                modelsDirectory.absolutePath,
                voicesDirectory.absolutePath,
                precision,
                temperature,
                lsdSteps,
                threads.coerceIn(1, 8),
                sentencePauseMs.coerceIn(0, 2000),
                maxTextTokens.coerceIn(10, 200)
            )
            EngineResult.Ready
        } catch (error: Throwable) {
            native = null
            EngineResult.Failed(error.message ?: "Falha ao inicializar o Pocket TTS.")
        }
    }

    override suspend fun synthesize(request: SpeechRequest): SpeechResult = withContext(Dispatchers.IO) {
        if (request.text.isBlank()) return@withContext SpeechResult.Failed("O texto para síntese está vazio.")
        if (!request.languageTag.startsWith("pt", ignoreCase = true)) {
            return@withContext SpeechResult.Failed("Este perfil do Pocket TTS está configurado para português.")
        }
        val runtime = native ?: return@withContext SpeechResult.Failed("O Pocket TTS ainda não foi inicializado.")
        val voice = request.referenceAudioPath?.let(::File) ?: defaultVoiceFile
        if (!voice.isFile || !voice.canRead()) {
            return@withContext SpeechResult.Failed("O arquivo de referência vocal não existe ou não pode ser lido.")
        }

        val pcm = ByteArrayOutputStream()
        var sampleCount = 0L
        val success = try {
            runtime.synthesize(request.text, voice.absolutePath) { samples ->
                if (samples.isEmpty()) return@synthesize true
                if (sampleCount + samples.size > MAX_SAMPLES) return@synthesize false
                val bytes = ByteArray(samples.size * 2)
                var offset = 0
                for (sample in samples) {
                    val clipped = sample.coerceIn(-1.0f, 1.0f)
                    val value = (clipped * if (clipped < 0f) 32768f else 32767f).toInt()
                    bytes[offset++] = (value and 0xff).toByte()
                    bytes[offset++] = ((value ushr 8) and 0xff).toByte()
                }
                pcm.write(bytes)
                sampleCount += samples.size
                true
            }
        } catch (error: Throwable) {
            return@withContext SpeechResult.Failed(error.message ?: "Erro durante a síntese Pocket TTS.")
        }
        if (!success || pcm.size() == 0) {
            SpeechResult.Failed("A síntese Pocket TTS foi interrompida ou não produziu áudio.")
        } else {
            SpeechResult.Audio(pcm.toByteArray(), SAMPLE_RATE_HZ, channels = 1)
        }
    }

    override fun close() {
        native?.close()
        native = null
    }

    companion object {
        private const val SAMPLE_RATE_HZ = 24_000
        private const val MAX_SAMPLES = SAMPLE_RATE_HZ.toLong() * 60L * 10L
    }
}
