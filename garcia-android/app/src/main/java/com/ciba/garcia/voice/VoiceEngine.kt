package com.ciba.garcia.voice

/**
 * Common contract for speech synthesis and voice-cloning engines.
 * Runtime adapters are enabled only after Android, ABI, model and license validation.
 * Model weights are downloaded separately and are never packaged in the APK.
 */
interface VoiceEngine {
    val id: String
    suspend fun initialize(): EngineResult
    suspend fun synthesize(request: SpeechRequest): SpeechResult
    fun close()
}

data class SpeechRequest(
    val text: String,
    val languageTag: String = "pt-BR",
    /** Reference audio must belong to the owner or be used with explicit consent. */
    val referenceAudioPath: String? = null
)

sealed interface EngineResult {
    data object Ready : EngineResult
    data class Unavailable(val reason: String) : EngineResult
    data class Failed(val reason: String) : EngineResult
}

sealed interface SpeechResult {
    data class Audio(val pcm16: ByteArray, val sampleRateHz: Int, val channels: Int = 1) : SpeechResult
    data class Failed(val reason: String) : SpeechResult
}

enum class EngineMaturity { PLANNED, EXPERIMENTAL, LAB_ONLY, LANGUAGE_LIMITED }
enum class EngineExecution { ON_DEVICE, REMOTE_LAB }

data class VoiceEngineDescriptor(
    val id: String,
    val displayName: String,
    val execution: EngineExecution,
    val maturity: EngineMaturity,
    val supportsVoiceCloning: Boolean,
    val supportedLanguages: Set<String>,
    val licenseSummary: String,
    val integrationNotes: String
)

/** Descriptive catalog only; entries do not imply that a runtime/model is installed or ready. */
object VoiceEngineCatalog {
    val engines: List<VoiceEngineDescriptor> = listOf(
        VoiceEngineDescriptor(
            id = "pocket-tts",
            displayName = "Pocket TTS",
            execution = EngineExecution.ON_DEVICE,
            maturity = EngineMaturity.EXPERIMENTAL,
            supportsVoiceCloning = true,
            supportedLanguages = setOf("pt", "en", "fr", "de", "it", "es", "nl"),
            licenseSummary = "Código MIT; pesos CC-BY-4.0, com atribuição obrigatória.",
            integrationNotes = "Runtime nativo a incorporar via JNI/C++ na Garcia, baseado na referência PocketTTS-Android-Engine v0.5.5. Modelos externos ao APK; validar pt-BR e ARM64 antes de marcar pronto."
        ),
        VoiceEngineDescriptor(
            id = "neutts",
            displayName = "NeuTTS",
            execution = EngineExecution.ON_DEVICE,
            maturity = EngineMaturity.LANGUAGE_LIMITED,
            supportsVoiceCloning = true,
            supportedLanguages = setOf("en", "fr", "de", "es"),
            licenseSummary = "Validar licenças específicas do código, backbone e codec de cada modelo.",
            integrationNotes = "Protótipo Android comunitário; PT-BR não consta no catálogo de modelos avaliado."
        ),
        VoiceEngineDescriptor(
            id = "voxcpm2",
            displayName = "VoxCPM2",
            execution = EngineExecution.REMOTE_LAB,
            maturity = EngineMaturity.LAB_ONLY,
            supportsVoiceCloning = true,
            supportedLanguages = emptySet(),
            licenseSummary = "Validar licença dos pesos e condições de uso do checkpoint escolhido.",
            integrationNotes = "Plano A de laboratório em Kaggle/Colab com GPU; não é runtime Android."
        ),
        VoiceEngineDescriptor(
            id = "xtts-v2",
            displayName = "XTTS-v2",
            execution = EngineExecution.REMOTE_LAB,
            maturity = EngineMaturity.LAB_ONLY,
            supportsVoiceCloning = true,
            supportedLanguages = setOf("pt"),
            licenseSummary = "Coqui Public Model License; revisar restrições comerciais e redistribuição.",
            integrationNotes = "Plano B de laboratório; avaliar qualidade PT-BR, compatibilidade e licença."
        )
    )

    fun find(id: String): VoiceEngineDescriptor? = engines.firstOrNull { it.id == id }
}
