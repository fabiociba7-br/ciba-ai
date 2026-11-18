package com.ciba.garcia

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.ciba.garcia.chatterbox.ChatterboxNative
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object ClonedVoiceRuntime {
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val ready = AtomicBoolean(false)
    @Volatile private var track: AudioTrack? = null
    @Volatile private var loading = false

    fun isReady() = ready.get()

    private fun profileCache(context: Context): File {
        val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
        val safeName = prefs.getString("active_name", "voice").orEmpty()
            .lowercase().replace(Regex("[^a-z0-9_-]"), "-").take(40).ifBlank { "voice" }
        return File(context.filesDir, "voice-profiles/" + safeName)
    }

    fun activate(context: Context, referenceWav: File, onResult: (Result<Unit>) -> Unit = {}) {
        val models = ChatterboxModelManager.installed(context)
        if (models == null) {
            onResult(Result.failure(IllegalStateException("Baixe os modelos Chatterbox antes de preparar a voz.")))
            return
        }
        if (loading) return
        loading = true
        executor.execute {
            val result = runCatching {
                synchronized(lock) {
                    ready.set(false)
                    ChatterboxNative.nativeRelease()
                    val cache = profileCache(context)
                    check(ChatterboxNative.nativeCreate(models.t3.absolutePath, models.s3.absolutePath,
                        referenceWav.absolutePath, cache.absolutePath, "pt")) { "Não foi possível inicializar o Chatterbox." }
                    ready.set(true)
                }
            }
            loading = false
            onResult(result)
        }
    }

    fun restore(context: Context) {
        val prefs = context.getSharedPreferences("garcia_voice_profiles", Context.MODE_PRIVATE)
        val wav = prefs.getString("active_wav", null)?.let(::File) ?: return
        if (wav.isFile && ChatterboxModelManager.installed(context) != null && !ready.get()) {
            val models = ChatterboxModelManager.installed(context) ?: return
            val cache = profileCache(context)
            if (listOf("speaker_emb.npy", "cond_prompt_speech_tokens.npy", "embedding.npy", "prompt_token.npy", "prompt_feat.npy").all { File(cache, it).isFile }) {
                if (loading) return
                loading = true
                executor.execute {
                    val result = runCatching {
                        synchronized(lock) {
                            check(ChatterboxNative.nativeCreate(models.t3.absolutePath, models.s3.absolutePath,
                                "", cache.absolutePath, "pt")) { "Não foi possível carregar o perfil de voz salvo." }
                            ready.set(true)
                        }
                    }
                    if (result.isFailure) ready.set(false)
                    loading = false
                }
            } else activate(context, wav)
        }
    }

    fun speak(text: String, onStarted: () -> Unit, onDone: () -> Unit, onError: (Throwable) -> Unit) {
        if (!ready.get()) { onError(IllegalStateException("Perfil de voz ainda não está pronto.")); return }
        executor.execute {
            try {
                val pcm = ChatterboxNative.nativeSynthesize(text)
                val minimum = AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_FLOAT).coerceAtLeast(4096)
                val audio = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(24_000)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).build())
                    .setBufferSizeInBytes(minimum * 2).setTransferMode(AudioTrack.MODE_STREAM).build()
                track = audio
                audio.play()
                onStarted()
                var offset = 0
                while (offset < pcm.size && ready.get()) {
                    val n = audio.write(pcm, offset, minOf(4096, pcm.size - offset), AudioTrack.WRITE_BLOCKING)
                    if (n <= 0) error("Falha na reprodução de áudio: " + n)
                    offset += n
                }
                audio.stop(); audio.release(); track = null; onDone()
            } catch (error: Throwable) {
                track?.let { runCatching { it.pause(); it.flush(); it.release() } }
                track = null; onError(error)
            }
        }
    }

    fun stop() {
        track?.let { runCatching { it.pause(); it.flush(); it.stop(); it.release() } }
        track = null
        runCatching { ChatterboxNative.nativeCancel() }
    }

    fun release() {
        stop(); ready.set(false)
        executor.execute { synchronized(lock) { ChatterboxNative.nativeRelease() } }
    }
}
