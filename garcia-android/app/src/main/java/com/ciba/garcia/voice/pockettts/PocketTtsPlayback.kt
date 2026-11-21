package com.ciba.garcia.voice.pockettts

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.ciba.garcia.voice.EngineResult
import com.ciba.garcia.voice.SpeechRequest
import com.ciba.garcia.voice.SpeechResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/** Plays Pocket TTS output from Garcia's private model/profile stores. */
internal object PocketTtsPlayback {
    private val activeTrack = AtomicReference<AudioTrack?>(null)

    fun isConfigured(context: Context): Boolean {
        val prefs = context.getSharedPreferences("garcia_pockettts", Context.MODE_PRIVATE)
        val id = prefs.getString("selected_pack", null) ?: return false
        return File(context.filesDir, "pockettts/models/$id/manifest.json").isFile
    }

    suspend fun speak(context: Context, text: String): Boolean = withContext(Dispatchers.IO) {
        if (text.isBlank()) return@withContext false
        val prefs = context.getSharedPreferences("garcia_pockettts", Context.MODE_PRIVATE)
        val packId = prefs.getString("selected_pack", null) ?: return@withContext false
        val pack = PocketTtsModelPackManager(File(context.filesDir, "pockettts/models"))
            .listInstalledPacks().firstOrNull { it.id == packId } ?: return@withContext false
        val profileId = prefs.getString("selected_profile", "").orEmpty()
        val profile = if (profileId.isNotBlank()) File(context.filesDir, "pockettts/profiles/$profileId.wav").takeIf { it.isFile } else null
        val bundledVoice = pack.voicesDirectory.walkTopDown().firstOrNull { it.isFile && it.extension.equals("wav", true) }
        val defaultVoice = profile ?: bundledVoice ?: return@withContext false
        val engine = PocketTtsVoiceEngine(
            modelsDirectory = pack.modelsDirectory,
            voicesDirectory = pack.voicesDirectory,
            defaultVoiceFile = defaultVoice,
            precision = pack.precision,
            temperature = pack.temperature,
            lsdSteps = pack.lsdSteps,
            threads = pack.threads,
            sentencePauseMs = pack.sentencePauseMs,
            maxTextTokens = pack.maxTextTokens
        )
        try {
            when (val initialized = engine.initialize()) {
                EngineResult.Ready -> Unit
                is EngineResult.Unavailable, is EngineResult.Failed -> return@withContext false
            }
            val reference = defaultVoice
            when (val result = engine.synthesize(SpeechRequest(text = text, referenceAudioPath = reference.absolutePath))) {
                is SpeechResult.Failed -> false
                is SpeechResult.Audio -> playPcm(result.pcm16, result.sampleRateHz, result.channels)
            }
        } catch (_: Throwable) {
            false
        } finally {
            engine.close()
        }
    }

    fun stop() {
        activeTrack.getAndSet(null)?.let { track ->
            runCatching { track.pause(); track.flush(); track.stop(); track.release() }
        }
    }

    private suspend fun playPcm(pcm: ByteArray, sampleRate: Int, channels: Int): Boolean {
        if (pcm.isEmpty() || sampleRate <= 0 || channels != 1) return false
        val channelMask = AudioFormat.CHANNEL_OUT_MONO
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) return false
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(channelMask)
                .build())
            .setBufferSizeInBytes(maxOf(minBuffer * 2, 64 * 1024))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        activeTrack.getAndSet(track)?.let { old -> runCatching { old.stop(); old.release() } }
        return try {
            track.play()
            var offset = 0
            while (offset < pcm.size) {
                val written = track.write(pcm, offset, pcm.size - offset, AudioTrack.WRITE_BLOCKING)
                if (written <= 0) return false
                offset += written
            }
            val totalFrames = pcm.size / 2
            while (track.playbackHeadPosition.toLong() < totalFrames.toLong()) delay(40)
            true
        } catch (_: Throwable) {
            false
        } finally {
            activeTrack.compareAndSet(track, null)
            runCatching { track.stop(); track.release() }
        }
    }
}
