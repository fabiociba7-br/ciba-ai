package com.ciba.garcia

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.ciba.garcia.chatterbox.ChatterboxNative
import java.io.File
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

    /** Must be called while holding lock and from executor. */
    private fun ensureActiveProfileLocked(context: Context) {
        if (ready.get()) return
        val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
        val wav = prefs.getString("active_wav", null)?.let(::File)
            ?: error("Nenhum perfil de voz clonado está selecionado.")
        check(wav.isFile) { "A gravação de referência do perfil não foi encontrada." }
        val models = ChatterboxModelManager.installed(context)
            ?: error("Os modelos Chatterbox não estão instalados. Baixe-os em Clonar minha voz.")
        val cache = profileCache(context)
        val cached = cacheFiles.all { File(cache, it).isFile }
        ChatterboxNative.nativeRelease()
        check(
            ChatterboxNative.nativeCreate(
                models.t3.absolutePath,
                models.s3.absolutePath,
                if (cached) "" else wav.absolutePath,
                cache.absolutePath,
                "pt"
            )
        ) { "Não foi possível inicializar o perfil de voz no Chatterbox." }
        ready.set(true)
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
                    check(referenceWav.isFile) { "A gravação de referência não foi encontrada." }
                    val models = ChatterboxModelManager.installed(context)
                        ?: error("Baixe os modelos Chatterbox antes de preparar a voz.")
                    val cache = profileCache(context)
                    val cached = cacheFiles.all { File(cache, it).isFile }
                    ChatterboxNative.nativeRelease()
                    check(
                        ChatterboxNative.nativeCreate(
                            models.t3.absolutePath,
                            models.s3.absolutePath,
                            if (cached) "" else referenceWav.absolutePath,
                            cache.absolutePath,
                            "pt"
                        )
                    ) { "Não foi possível inicializar o Chatterbox." }
                    ready.set(true)
                }
            }
            loading = false
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
            if (result.isFailure) ready.set(false)
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
                val minimum = AudioTrack.getMinBufferSize(
                    24_000,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_FLOAT
                )
                check(minimum > 0) { "O Android não disponibilizou saída de áudio compatível." }
                audio = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(24_000)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                            .build()
                    )
                    .setBufferSizeInBytes(minimum.coerceAtLeast(4096) * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                check(audio.state == AudioTrack.STATE_INITIALIZED) {
                    "Não foi possível inicializar a saída de áudio da voz clonada."
                }
                track = audio
                audio.play()
                onStarted()
                var offset = 0
                while (offset < pcm.size && ready.get()) {
                    val count = audio.write(
                        pcm,
                        offset,
                        minOf(4096, pcm.size - offset),
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
