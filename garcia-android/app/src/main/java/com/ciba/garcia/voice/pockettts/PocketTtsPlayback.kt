package com.ciba.garcia.voice.pockettts

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.ciba.garcia.voice.EngineResult
import com.ciba.garcia.voice.SpeechRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * Keeps the native model session warm between answers and streams PCM directly to AudioTrack.
 * A single mutex serializes inference because the embedded native runtime is not re-entrant.
 */
internal object PocketTtsPlayback {
    private val activeTrack = AtomicReference<AudioTrack?>(null)
    private val synthesisMutex = Mutex()
    @Volatile private var cachedEngine: PocketTtsVoiceEngine? = null
    @Volatile private var cachedEngineKey: String? = null

    fun isConfigured(context: Context): Boolean {
        val prefs = context.getSharedPreferences("garcia_pockettts", Context.MODE_PRIVATE)
        val id = prefs.getString("selected_pack", null) ?: return false
        return File(context.filesDir, "pockettts/models/$id/manifest.json").isFile
    }

    /** True only when the user explicitly chose Pocket TTS as the default output voice. */
    fun isSelected(context: Context): Boolean =
        context.getSharedPreferences("garcia_voice", Context.MODE_PRIVATE)
            .getString("voice_mode", "system") == "pockettts" && isConfigured(context)

    suspend fun speak(context: Context, text: String): Boolean = withContext(Dispatchers.IO) {
        if (text.isBlank()) return@withContext false
        synthesisMutex.withLock {
            val prefs = context.getSharedPreferences("garcia_pockettts", Context.MODE_PRIVATE)
            val packId = prefs.getString("selected_pack", null) ?: return@withLock false
            val pack = PocketTtsModelPackManager(File(context.filesDir, "pockettts/models"))
                .listInstalledPacks().firstOrNull { it.id == packId } ?: return@withLock false
            val profileId = prefs.getString("selected_profile", "").orEmpty()
            val profile = if (profileId.isNotBlank())
                File(context.filesDir, "pockettts/profiles/$profileId.wav").takeIf { it.isFile } else null
            val bundledVoice = pack.voicesDirectory.walkTopDown()
                .firstOrNull { it.isFile && it.extension.equals("wav", true) }
            val defaultVoice = profile ?: bundledVoice ?: return@withLock false

            // Engine creation/model loading is expensive; reuse it while the selected pack is unchanged.
            val key = listOf(pack.id, pack.modelsDirectory.absolutePath, pack.precision,
                pack.temperature, pack.lsdSteps, pack.threads, pack.sentencePauseMs, pack.maxTextTokens).joinToString("|")
            var engine = cachedEngine
            if (engine == null || cachedEngineKey != key) {
                cachedEngine?.close()
                engine = PocketTtsVoiceEngine(
                    modelsDirectory = pack.modelsDirectory,
                    voicesDirectory = pack.voicesDirectory,
                    defaultVoiceFile = bundledVoice ?: defaultVoice,
                    precision = pack.precision,
                    temperature = pack.temperature,
                    lsdSteps = pack.lsdSteps,
                    threads = pack.threads,
                    sentencePauseMs = pack.sentencePauseMs,
                    maxTextTokens = pack.maxTextTokens
                )
                when (engine.initialize()) {
                    EngineResult.Ready -> {
                        cachedEngine = engine
                        cachedEngineKey = key
                    }
                    is EngineResult.Unavailable, is EngineResult.Failed -> {
                        engine.close()
                        cachedEngine = null
                        cachedEngineKey = null
                        return@withLock false
                    }
                }
            }

            val track = createTrack() ?: return@withLock false
            activeTrack.getAndSet(track)?.let { old ->
                runCatching { old.pause(); old.flush(); old.stop(); old.release() }
            }
            try {
                // Start playback before inference; the first generated chunk is audible immediately.
                track.play()
                val generated = engine.synthesizeTo(
                    SpeechRequest(text = text, languageTag = "pt-BR", referenceAudioPath = defaultVoice.absolutePath)
                ) { chunk ->
                    var offset = 0
                    while (offset < chunk.size) {
                        val written = track.write(chunk, offset, chunk.size - offset, AudioTrack.WRITE_BLOCKING)
                        if (written <= 0) return@synthesizeTo false
                        offset += written
                    }
                    true
                }
                if (!generated) return@withLock false
                val totalFrames = track.playbackHeadPosition.toLong()
                // Wait for the queued stream to drain. playbackHeadPosition wraps only after ~24 h.
                while (track.playState == AudioTrack.PLAYSTATE_PLAYING &&
                    track.playbackHeadPosition.toLong() < totalFrames) {
                    kotlinx.coroutines.delay(30)
                }
                true
            } catch (_: Throwable) {
                false
            } finally {
                activeTrack.compareAndSet(track, null)
                runCatching { track.stop(); track.release() }
            }
        }
    }

    fun stop() {
        activeTrack.getAndSet(null)?.let { track ->
            runCatching { track.pause(); track.flush(); track.stop(); track.release() }
        }
    }

    /** Explicitly release the warm model session when Garcia is shutting down or changing packs. */
    fun release() {
        cachedEngine?.close()
        cachedEngine = null
        cachedEngineKey = null
    }

    private fun createTrack(): AudioTrack? {
        val mask = AudioFormat.CHANNEL_OUT_MONO
        val minBuffer = AudioTrack.getMinBufferSize(SAMPLE_RATE_HZ, mask, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) return null
        return runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAudioFormat(AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE_HZ)
                    .setChannelMask(mask)
                    .build())
                .setBufferSizeInBytes(maxOf(minBuffer * 2, 32 * 1024))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        }.getOrNull()
    }

    private const val SAMPLE_RATE_HZ = 24_000
}
