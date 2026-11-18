package com.ciba.garcia

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.ciba.garcia.chatterbox.ChatterboxNative
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Serializes Chatterbox initialization, synthesis and release. A saved active
 * profile is initialized on demand before the first utterance, so startup
 * timing cannot silently discard the first spoken reply.
 */
internal object ClonedVoiceRuntime {
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val ready = AtomicBoolean(false)
    @Volatile private var track: AudioTrack? = null
    @Volatile private var loading = false

    private val cacheFiles = listOf(
        "speaker_emb.npy",
        "cond_prompt_speech_tokens.npy",
        "embedding.npy",
        "prompt_token.npy",
        "prompt_feat.npy"
    )

    fun isReady() = ready.get()
    fun isLoading() = loading

    fun hasActiveProfile(context: Context): Boolean =
        !context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
            .getString("active_profile_id", null).isNullOrBlank()

    private fun profileCache(context: Context): File {
        val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
        val id = prefs.getString("active_profile_id", null) ?: "unassigned"
        return File(context.filesDir, "voice-profiles/" + id + "/cache")
    }


    private fun validateReference(wav: File) {
        check(wav.isFile && wav.length() > 44L) { "A gravação original da voz não foi encontrada ou está vazia." }
        FileInputStream(wav).use { input ->
            val header = ByteArray(44)
            var offset = 0
            while (offset < header.size) {
                val count = input.read(header, offset, header.size - offset)
                check(count > 0) { "A gravação original está incompleta." }
                offset += count
            }
            check(String(header, 0, 4, Charsets.US_ASCII) == "RIFF" && String(header, 8, 4, Charsets.US_ASCII) == "WAVE") {
                "A gravação original não está em formato WAV válido."
            }
            val data = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            check((data.getShort(20).toInt() and 0xffff) == 1 && (data.getShort(22).toInt() and 0xffff) == 1 && data.getInt(24) == 24_000 && (data.getShort(34).toInt() and 0xffff) == 16) {
                "A gravação original precisa estar em PCM mono, 24 kHz e 16 bits."
            }
        }
    }

    /** Must be called while holding lock and from executor. */
    private fun ensureActiveProfileLocked(context: Context) {
        if (ready.get()) return
        val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
        val wav = prefs.getString("active_wav", null)?.let(::File)
            ?: error("Nenhum perfil de voz clonado está selecionado.")
        validateReference(wav)
        val models = ChatterboxModelManager.installed(context)
            ?: error("Os modelos Chatterbox não estão instalados. Baixe-os em Clonar minha voz.")
        val cache = profileCache(context)
        if (cache.exists() && !cache.deleteRecursively()) error("Não foi possível reparar o cache antigo da voz clonada.")
        check(cache.mkdirs() || cache.isDirectory) { "Não foi possível criar o cache do perfil de voz." }
        ChatterboxNative.nativeRelease()
        check(
            ChatterboxNative.nativeCreate(
                models.t3.absolutePath,
                models.s3.absolutePath,
                wav.absolutePath,
                cache.absolutePath,
                "pt"
            )
        ) { "Não foi possível inicializar o perfil de voz no Chatterbox." }
        ready.set(true)
        GarciaLog.recordEvent(context, "Voz clonada", "Perfil carregado diretamente da gravação original; modelos encontrados no armazenamento interno.")
    }

    fun activate(context: Context, referenceWav: File, onResult: (Result<Unit>) -> Unit = {}) {
        loading = true
        executor.execute {
            val result = runCatching {
                synchronized(lock) {
                    ready.set(false)
                    val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
                    check(prefs.getString("active_profile_id", null) != null) {
                        "Selecione e salve um perfil antes de preparar a voz."
                    }
                    validateReference(referenceWav)
                    val models = ChatterboxModelManager.installed(context)
                        ?: error("Baixe os modelos Chatterbox antes de preparar a voz.")
                    val cache = profileCache(context)
                    if (cache.exists() && !cache.deleteRecursively()) error("Não foi possível limpar o cache antigo da voz.")
                    check(cache.mkdirs() || cache.isDirectory) { "Não foi possível criar o cache do perfil." }
                    ChatterboxNative.nativeRelease()
                    check(
                        ChatterboxNative.nativeCreate(
                            models.t3.absolutePath,
                            models.s3.absolutePath,
                            referenceWav.absolutePath,
                            cache.absolutePath,
                            "pt"
                        )
                    ) { "Não foi possível inicializar o Chatterbox." }
                    ready.set(true)
                    GarciaLog.recordEvent(context, "Voz clonada", "Ativação concluída com a gravação original (" + referenceWav.length() + " bytes).")
                }
            }
            loading = false
            result.exceptionOrNull()?.let { GarciaLog.record(context, "Ativação da voz clonada", it) }
            onResult(result)
        }
    }

    fun restore(context: Context) {
        if (!hasActiveProfile(context) || ready.get() || loading) return
        loading = true
        executor.execute {
            val result = runCatching {
                synchronized(lock) { ensureActiveProfileLocked(context) }
            }
            if (result.isFailure) {
                ready.set(false)
                result.exceptionOrNull()?.let { GarciaLog.record(context, "Restauração da voz clonada", it) }
            }
            loading = false
        }
    }

    /**
     * Always queues the utterance. If app startup has not restored the clone
     * yet, it initializes the persisted profile in this same serialized task.
     */
    fun speak(
        context: Context,
        text: String,
        onStarted: () -> Unit,
        onDone: () -> Unit,
        onError: (Throwable) -> Unit
    ) {
        executor.execute {
            var audio: AudioTrack? = null
            try {
                val pcm = synchronized(lock) {
                    loading = true
                    try {
                        ensureActiveProfileLocked(context)
                    } finally {
                        loading = false
                    }
                    ChatterboxNative.nativeSynthesize(text)
                }
                check(pcm.isNotEmpty()) { "O Chatterbox não gerou áudio para esta resposta." }
                var peak = 0f
                var sumSquares = 0.0
                var nonFinite = 0
                pcm.forEach { sample ->
                    if (!sample.isFinite()) nonFinite++ else {
                        peak = maxOf(peak, kotlin.math.abs(sample))
                        sumSquares += sample.toDouble() * sample.toDouble()
                    }
                }
                val rms = kotlin.math.sqrt(sumSquares / pcm.size).toFloat()
                check(nonFinite == 0 && peak > 0.00001f && rms > 0.000001f) {
                    "PCM inválido/silencioso: amostras=" + pcm.size + ", pico=" + peak + ", RMS=" + rms + ", inválidas=" + nonFinite
                }
                GarciaLog.recordEvent(context, "Áudio clonado", "PCM gerado: " + pcm.size + " amostras · pico=" + peak + " · RMS=" + rms)
                // Convert the engine's 24 kHz float32 output to PCM16. PCM16
                // is supported by a wider range of Android audio HALs and
                // avoids devices that initialize float AudioTrack but emit silence.
                val pcm16 = ShortArray(pcm.size) { index ->
                    val sample = pcm[index].takeIf { it.isFinite() }?.coerceIn(-1.0f, 1.0f) ?: 0.0f
                    (sample * 32767.0f).toInt().toShort()
                }
                val minimum = AudioTrack.getMinBufferSize(
                    24_000,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                check(minimum > 0) { "O Android não disponibilizou saída de áudio compatível." }
                audio = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            // Route synthesized speech through the normal media/music
                            // output. USAGE_ASSISTANT can be independently muted on
                            // Android devices, making successful synthesis inaudible.
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(24_000)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .build()
                    )
                    .setBufferSizeInBytes(minimum.coerceAtLeast(4096) * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                check(audio.state == AudioTrack.STATE_INITIALIZED) {
                    "Não foi possível inicializar a saída de áudio da voz clonada."
                }
                track = audio
                audio.setVolume(1.0f)
                audio.play()
                check(audio.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    "O Android não iniciou a reprodução da voz clonada."
                }
                onStarted()
                var offset = 0
                while (offset < pcm.size && ready.get()) {
                    val count = audio.write(
                        pcm16,
                        offset,
                        minOf(4096, pcm16.size - offset),
                        AudioTrack.WRITE_BLOCKING
                    )
                    if (count <= 0) error("Falha na reprodução de áudio: $count")
                    offset += count
                }
                audio.stop()
                audio.release()
                audio = null
                track = null
                onDone()
            } catch (error: Throwable) {
                audio?.let { runCatching { it.pause(); it.flush(); it.release() } }
                track?.let { runCatching { it.pause(); it.flush(); it.release() } }
                track = null
                GarciaLog.record(context, "Reprodução da voz clonada", error)
                onError(error)
            }
        }
    }

    fun stop() {
        track?.let { runCatching { it.pause(); it.flush(); it.stop(); it.release() } }
        track = null
        runCatching { ChatterboxNative.nativeCancel() }
    }

    fun release() {
        stop()
        ready.set(false)
        executor.execute {
            synchronized(lock) { ChatterboxNative.nativeRelease() }
        }
    }
}
