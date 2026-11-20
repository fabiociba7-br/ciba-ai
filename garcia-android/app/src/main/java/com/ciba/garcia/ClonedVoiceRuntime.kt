package com.ciba.garcia

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import com.ciba.garcia.chatterbox.ChatterboxNative
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Serializes native model loading, synthesis, preview and release on one worker.
 * Owns AudioTrack playback with explicit audio focus so cloned speech is not silent
 * when media volume / focus would otherwise duck the stream.
 */
internal object ClonedVoiceRuntime {
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val ready = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    @Volatile private var track: AudioTrack? = null
    @Volatile private var loading = false
    @Volatile private var loadedProfileId: String? = null
    @Volatile private var focusRequest: AudioFocusRequest? = null
    @Volatile private var focusGranted = false

    fun isReady(): Boolean = ready.get()
    fun isLoading(): Boolean = loading

    fun hasActiveProfile(context: Context): Boolean =
        VoiceProfileStore(context).activeProfileId() != null

    /** Validates PCM mono 24 kHz 16-bit WAV written by VoiceAudioNormalizer. */
    private fun validateReference(wav: File) {
        check(wav.isFile && wav.length() > 44L) {
            "A gravação normalizada da voz não foi encontrada ou está vazia."
        }
        RandomAccessFile(wav, "r").use { raf ->
            val riff = ByteArray(4)
            raf.readFully(riff)
            check(String(riff, Charsets.US_ASCII) == "RIFF") { "A referência não é um WAV RIFF válido." }
            raf.skipBytes(4)
            val wave = ByteArray(4)
            raf.readFully(wave)
            check(String(wave, Charsets.US_ASCII) == "WAVE") { "A referência não é um arquivo WAVE." }

            var audioFormat = -1
            var channels = -1
            var sampleRate = -1
            var bits = -1
            var dataSize = -1L
            while (raf.filePointer + 8 <= raf.length()) {
                val chunkId = ByteArray(4)
                raf.readFully(chunkId)
                val sizeBuf = ByteArray(4)
                raf.readFully(sizeBuf)
                val chunkSize = ByteBuffer.wrap(sizeBuf).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
                val id = String(chunkId, Charsets.US_ASCII)
                when (id) {
                    "fmt " -> {
                        val fmt = ByteArray(chunkSize.toInt().coerceAtMost(64))
                        raf.readFully(fmt)
                        val bb = ByteBuffer.wrap(fmt).order(ByteOrder.LITTLE_ENDIAN)
                        audioFormat = bb.short.toInt() and 0xffff
                        channels = bb.short.toInt() and 0xffff
                        sampleRate = bb.int
                        bb.int // byte rate
                        bb.short // block align
                        bits = bb.short.toInt() and 0xffff
                        if (chunkSize > fmt.size) raf.skipBytes((chunkSize - fmt.size).toInt())
                    }
                    "data" -> {
                        dataSize = chunkSize
                        break
                    }
                    else -> raf.skipBytes(chunkSize.toInt())
                }
                // chunks are word-aligned
                if (chunkSize % 2L == 1L && raf.filePointer < raf.length()) raf.skipBytes(1)
            }
            check(audioFormat == 1) { "A referência precisa ser PCM linear (formato 1)." }
            check(channels == 1) { "A referência precisa ser mono." }
            check(sampleRate == 24_000) { "A referência precisa estar em 24 kHz (encontrado $sampleRate)." }
            check(bits == 16) { "A referência precisa ser 16 bits (encontrado $bits)." }
            check(dataSize > 0L) { "A referência não contém bloco de dados de áudio." }
        }
    }

    private fun cacheFiles(profile: GarciaVoiceProfile): List<File> {
        val cache = File(profile.wav.parentFile, "cache")
        return listOf(
            File(cache, "speaker_emb.npy"),
            File(cache, "cond_prompt_speech_tokens.npy"),
            File(cache, "embedding.npy"),
            File(cache, "prompt_token.npy"),
            File(cache, "prompt_feat.npy")
        )
    }

    private fun cacheIsComplete(profile: GarciaVoiceProfile): Boolean =
        cacheFiles(profile).all { it.isFile && it.length() > 16L }

    /** Must be called on the serialized executor while holding lock. */
    private fun loadProfileLocked(context: Context, profile: GarciaVoiceProfile, force: Boolean = false) {
        if (!force && ready.get() && loadedProfileId == profile.id) return
        check(ChatterboxNative.isLibraryLoaded()) {
            "O runtime nativo Chatterbox não está carregado neste aparelho."
        }
        check(profile.integrityValid) {
            "O perfil de voz não passou na verificação de integridade."
        }
        validateReference(profile.wav)
        val models = ChatterboxModelManager.installed(context)
            ?: error("Os modelos Chatterbox não estão instalados. Baixe ou importe T3 e S3Gen em Clonar minha voz.")
        val cache = File(profile.wav.parentFile, "cache")
        val useCache = cacheIsComplete(profile)
        if (!useCache) {
            if (cache.exists() && !cache.deleteRecursively()) {
                error("Não foi possível reparar o cache do perfil de voz.")
            }
            check(cache.mkdirs() || cache.isDirectory) {
                "Não foi possível criar o cache do perfil de voz."
            }
        }
        ready.set(false)
        loadedProfileId = null
        ChatterboxNative.nativeRelease()
        val referencePath = if (useCache) "" else profile.wav.absolutePath
        check(
            ChatterboxNative.nativeCreate(
                models.t3.absolutePath,
                models.s3.absolutePath,
                referencePath,
                cache.absolutePath,
                "pt"
            )
        ) { "Não foi possível inicializar o perfil de voz no Chatterbox." }
        if (!useCache) {
            check(cacheIsComplete(profile)) {
                "O Chatterbox não conseguiu salvar os dados de condicionamento da voz. Tente gravar novamente com 10–15 s de fala clara."
            }
        }
        loadedProfileId = profile.id
        ready.set(true)
        GarciaLog.recordEvent(
            context,
            "Voz clonada",
            "Perfil local carregado; condicionamento " + if (useCache) "reutilizado." else "extraído da gravação."
        )
    }

    fun activate(context: Context, profile: GarciaVoiceProfile, onResult: (Result<Unit>) -> Unit = {}) {
        stop()
        loading = true
        executor.execute {
            val result = runCatching {
                cancelled.set(false)
                synchronized(lock) { loadProfileLocked(context, profile, force = true) }
            }
            loading = false
            result.exceptionOrNull()?.let {
                GarciaLog.recordEvent(context, "Voz clonada", "Falha ao ativar perfil: " + safeMessage(it))
            }
            onResult(result.map { Unit })
        }
    }

    fun restore(context: Context, onResult: (Result<Unit>) -> Unit = {}) {
        if (ready.get()) {
            onResult(Result.success(Unit))
            return
        }
        loading = true
        executor.execute {
            val result = runCatching {
                cancelled.set(false)
                // Ensure models are validated on disk after process death.
                check(ChatterboxModelManager.installed(context) != null) {
                    "Modelos Chatterbox ausentes após reinício do aplicativo."
                }
                val profile = VoiceProfileStore(context).currentProfile()
                    ?: error("Nenhum perfil clonado válido está ativo.")
                synchronized(lock) { loadProfileLocked(context, profile) }
            }
            loading = false
            result.exceptionOrNull()?.let {
                GarciaLog.recordEvent(context, "Restauração da voz clonada", safeMessage(it))
            }
            onResult(result.map { Unit })
        }
    }

    fun preview(
        context: Context,
        profile: GarciaVoiceProfile,
        text: String,
        onResult: (Result<Unit>) -> Unit
    ) {
        stop()
        loading = true
        executor.execute {
            val previous = VoiceProfileStore(context).currentProfile()
            val result = runCatching {
                cancelled.set(false)
                val pcm = synchronized(lock) {
                    loadProfileLocked(context, profile)
                    check(!cancelled.get()) { "Prévia da voz clonada interrompida." }
                    ChatterboxNative.nativeSynthesize(text)
                }
                playPcm(context, pcm, onStarted = {})
            }
            if (result.isFailure) {
                synchronized(lock) {
                    ready.set(false)
                    loadedProfileId = null
                    if (ChatterboxNative.isLibraryLoaded()) runCatching { ChatterboxNative.nativeRelease() }
                }
            }
            val restoreResult = runCatching {
                synchronized(lock) {
                    if (previous != null) loadProfileLocked(context, previous)
                    else {
                        if (ChatterboxNative.isLibraryLoaded()) ChatterboxNative.nativeRelease()
                        loadedProfileId = null
                        ready.set(false)
                    }
                }
            }
            loading = false
            val finalResult = if (result.isSuccess) restoreResult else result
            finalResult.exceptionOrNull()?.let {
                GarciaLog.recordEvent(context, "Prévia da voz clonada", "Falha: " + safeMessage(it))
            }
            onResult(finalResult.map { Unit })
        }
    }

    fun speak(
        context: Context,
        text: String,
        onStarted: () -> Unit,
        onDone: () -> Unit,
        onError: (Throwable) -> Unit
    ) {
        executor.execute {
            try {
                cancelled.set(false)
                val profile = VoiceProfileStore(context).currentProfile()
                    ?: error("A voz clonada está selecionada, mas o perfil local não foi encontrado.")
                val pcm = synchronized(lock) {
                    loading = true
                    try {
                        loadProfileLocked(context, profile)
                        GarciaLog.recordEvent(
                            context,
                            "Voz clonada",
                            "Síntese local iniciada · texto=" + text.length + " caracteres."
                        )
                        ChatterboxNative.nativeSynthesize(text)
                    } finally {
                        loading = false
                    }
                }
                playPcm(context, pcm, onStarted)
                GarciaLog.recordEvent(context, "Voz clonada", "Síntese e reprodução local concluídas.")
                onDone()
            } catch (error: Throwable) {
                track?.let { runCatching { it.pause(); it.flush(); it.release() } }
                track = null
                abandonFocus(context)
                if (cancelled.get()) {
                    GarciaLog.recordEvent(context, "Voz clonada", "Reprodução interrompida pelo usuário.")
                    onDone()
                    return@execute
                }
                synchronized(lock) {
                    ready.set(false)
                    loadedProfileId = null
                    if (ChatterboxNative.isLibraryLoaded()) runCatching { ChatterboxNative.nativeRelease() }
                }
                val safe = IllegalStateException(safeMessage(error))
                GarciaLog.recordEvent(context, "Voz clonada", "Falha de síntese/reprodução: " + safe.message)
                onError(safe)
            }
        }
    }

    private fun requestFocus(context: Context): Boolean {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
        return if (Build.VERSION.SDK_INT >= 26) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener { /* transient speech; ignore ducks */ }
                .build()
            focusRequest = req
            val result = am.requestAudioFocus(req)
            focusGranted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            focusGranted
        } else {
            @Suppress("DEPRECATION")
            val result = am.requestAudioFocus(
                null,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
            focusGranted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            focusGranted
        }
    }

    private fun abandonFocus(context: Context) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest?.let { runCatching { am.abandonAudioFocusRequest(it) } }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            runCatching { am.abandonAudioFocus(null) }
        }
        focusGranted = false
    }

    private fun playPcm(context: Context, pcm: FloatArray, onStarted: () -> Unit) {
        check(pcm.isNotEmpty()) { "O Chatterbox não gerou áudio para esta resposta." }
        check(!cancelled.get()) { "Reprodução da voz clonada interrompida." }

        var peak = 0f
        var sumSquares = 0.0
        var nonFinite = 0
        pcm.forEach { sample ->
            if (!sample.isFinite()) nonFinite++
            else {
                peak = maxOf(peak, kotlin.math.abs(sample))
                sumSquares += sample.toDouble() * sample.toDouble()
            }
        }
        val rms = kotlin.math.sqrt(sumSquares / pcm.size).toFloat()
        check(nonFinite == 0 && peak > 0.00001f && rms > 0.000001f) {
            "O motor gerou áudio inválido ou silencioso. Grave 10–15 s de fala clara, sem ruído de fundo, e tente de novo."
        }

        // Normalize quiet clones so the phone speaker is audible.
        val gain = when {
            peak < 0.05f -> (0.9f / peak).coerceAtMost(32.0f)
            peak < 0.15f -> (0.85f / peak).coerceAtMost(16.0f)
            else -> 1.0f
        }
        val pcm16 = ShortArray(pcm.size) { index ->
            val sample = pcm[index].times(gain).coerceIn(-1.0f, 1.0f)
            (sample * 32767.0f).toInt().toShort()
        }
        check(pcm16.any { it.toInt() != 0 }) {
            "O áudio ficou inaudível após a conversão para PCM16."
        }

        // Prefer assistant/speech attributes so volume follows voice path, not only media.
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        val minimum = AudioTrack.getMinBufferSize(
            24_000,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        check(minimum > 0) { "O Android não disponibilizou saída de áudio compatível." }

        requestFocus(context)

        val audio = AudioTrack.Builder()
            .setAudioAttributes(attributes)
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
        try {
            check(audio.state == AudioTrack.STATE_INITIALIZED) {
                "Não foi possível inicializar a saída de áudio da voz clonada."
            }
            track = audio
            audio.setVolume(1.0f)
            audio.play()
            check(audio.playState == AudioTrack.PLAYSTATE_PLAYING) {
                "O Android não iniciou a reprodução da voz clonada. Verifique o volume do aparelho."
            }
            onStarted()
            var offset = 0
            while (offset < pcm16.size) {
                check(!cancelled.get()) { "Reprodução da voz clonada interrompida." }
                val count = audio.write(
                    pcm16,
                    offset,
                    minOf(4096, pcm16.size - offset),
                    AudioTrack.WRITE_BLOCKING
                )
                if (count <= 0) error("Falha na reprodução de áudio: $count")
                offset += count
            }
            val deadline = android.os.SystemClock.elapsedRealtime() +
                ((pcm16.size * 1000L) / 24_000L) + 5_000L
            while (audio.playbackHeadPosition.toLong() < pcm16.size.toLong()) {
                check(!cancelled.get()) { "Reprodução da voz clonada interrompida." }
                check(android.os.SystemClock.elapsedRealtime() < deadline) {
                    "Tempo esgotado aguardando a saída de áudio do Android."
                }
                Thread.sleep(20)
            }
        } finally {
            track = null
            runCatching { audio.stop() }
            audio.release()
            abandonFocus(context)
        }
    }

    fun stop() {
        cancelled.set(true)
        track?.let { runCatching { it.pause(); it.flush(); it.stop(); it.release() } }
        track = null
        if (ChatterboxNative.isLibraryLoaded()) runCatching { ChatterboxNative.nativeCancel() }
    }

    fun release() {
        stop()
        ready.set(false)
        loadedProfileId = null
        if (ChatterboxNative.isLibraryLoaded()) {
            executor.execute {
                synchronized(lock) { runCatching { ChatterboxNative.nativeRelease() } }
            }
        }
    }

    private fun safeMessage(error: Throwable): String =
        (error.message ?: error.javaClass.simpleName)
            .replace(Regex("/(?:data|storage|mnt)/[^\\s]+"), "[arquivo local]")
            .take(400)
}
