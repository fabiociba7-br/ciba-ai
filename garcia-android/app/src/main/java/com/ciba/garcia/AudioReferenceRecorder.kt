package com.ciba.garcia

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.abs

/**
 * Private, on-device reference recorder. Captures native PCM16 at 48 kHz when
 * the device supports it; no lossy codec or artificial bit-depth upsampling.
 */
class AudioReferenceRecorder(private val outputDirectory: File) {
    companion object {
        const val SAMPLE_RATE = 48_000
        const val MAX_DURATION_SECONDS = 180
        private const val CHANNELS = 1
        private const val BITS_PER_SAMPLE = 16
    }

    @Volatile var peakLevel: Float = 0f
        private set
    @Volatile var isRecording: Boolean = false
        private set
    @Volatile var isPaused: Boolean = false
        private set
    @Volatile var durationMillis: Long = 0L
        private set

    private var recorder: AudioRecord? = null
    private var worker: Thread? = null
    private var rawFile: File? = null
    private val stopRequested = AtomicBoolean(false)
    private val lock = Any()
    private var startedAt = 0L
    private var accumulatedMillis = 0L
    private var pauseStartedAt = 0L

    @Synchronized
    fun start() {
        check(!isRecording) { "Já existe uma gravação em andamento." }
        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        check(minBuffer > 0) { "Este aparelho não oferece captura PCM a 48 kHz." }
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer * 2, SAMPLE_RATE / 5)
        )
        check(audioRecord.state == AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            "Não foi possível inicializar o microfone em 48 kHz."
        }
        outputDirectory.mkdirs()
        val raw = File.createTempFile("voice-reference-", ".pcm", outputDirectory)
        recorder = audioRecord
        rawFile = raw
        stopRequested.set(false)
        peakLevel = 0f
        durationMillis = 0L
        accumulatedMillis = 0L
        startedAt = System.currentTimeMillis()
        isPaused = false
        isRecording = true
        audioRecord.startRecording()
        worker = thread(name = "GarciaVoiceReferenceCapture", isDaemon = true) {
            captureLoop(audioRecord, raw)
        }
    }

    @Synchronized
    fun pause() {
        check(isRecording && !isPaused) { "Não há gravação ativa para pausar." }
        synchronized(lock) {
            accumulatedMillis += System.currentTimeMillis() - startedAt
            pauseStartedAt = System.currentTimeMillis()
            isPaused = true
        }
    }

    @Synchronized
    fun resume() {
        check(isRecording && isPaused) { "A gravação não está pausada." }
        synchronized(lock) {
            startedAt = System.currentTimeMillis()
            isPaused = false
        }
    }

    private fun captureLoop(audioRecord: AudioRecord, raw: File) {
        val buffer = ShortArray(4096)
        try {
            RandomAccessFile(raw, "rw").use { output ->
                while (!stopRequested.get()) {
                    val count = audioRecord.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
                    if (count <= 0) continue
                    val paused = synchronized(lock) { isPaused }
                    if (paused) continue
                    var peak = 0
                    val bytes = ByteArray(count * 2)
                    for (i in 0 until count) {
                        val sample = buffer[i].toInt()
                        peak = maxOf(peak, abs(sample))
                        bytes[i * 2] = (sample and 0xff).toByte()
                        bytes[i * 2 + 1] = ((sample shr 8) and 0xff).toByte()
                    }
                    output.write(bytes)
                    peakLevel = (peak / 32768f).coerceIn(0f, 1f)
                    val now = System.currentTimeMillis()
                    durationMillis = synchronized(lock) {
                        accumulatedMillis + if (isPaused) 0L else now - startedAt
                    }
                    if (durationMillis >= MAX_DURATION_SECONDS * 1000L) {
                        stopRequested.set(true)
                    }
                }
            }
        } finally {
            runCatching { audioRecord.stop() }
        }
    }

    @Synchronized
    fun stop(): File {
        check(isRecording) { "Não há gravação para finalizar." }
        synchronized(lock) {
            if (!isPaused) accumulatedMillis += System.currentTimeMillis() - startedAt
            isPaused = false
        }
        stopRequested.set(true)
        runCatching { recorder?.stop() }
        worker?.join(2_000)
        recorder?.release()
        recorder = null
        worker = null
        isRecording = false
        durationMillis = accumulatedMillis
        val raw = rawFile ?: error("Arquivo temporário de áudio ausente.")
        val wav = File(outputDirectory, "voice-reference-${System.currentTimeMillis()}.wav")
        try {
            writeWav(raw, wav)
        } finally {
            raw.delete()
            rawFile = null
            peakLevel = 0f
        }
        check(wav.length() > 44L) { "A gravação ficou vazia." }
        return wav
    }

    @Synchronized
    fun cancel() {
        if (!isRecording) return
        stopRequested.set(true)
        runCatching { recorder?.stop() }
        worker?.join(2_000)
        recorder?.release()
        recorder = null
        worker = null
        isRecording = false
        rawFile?.delete()
        rawFile = null
        isPaused = false
        peakLevel = 0f
        durationMillis = 0L
        accumulatedMillis = 0L
    }

    private fun writeWav(raw: File, wav: File) {
        val dataLength = raw.length().coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8
        RandomAccessFile(wav, "rw").use { out ->
            out.setLength(0)
            out.writeBytes("RIFF")
            out.writeIntLE(36 + dataLength)
            out.writeBytes("WAVE")
            out.writeBytes("fmt ")
            out.writeIntLE(16)
            out.writeShortLE(1)
            out.writeShortLE(CHANNELS)
            out.writeIntLE(SAMPLE_RATE)
            out.writeIntLE(byteRate)
            out.writeShortLE(CHANNELS * BITS_PER_SAMPLE / 8)
            out.writeShortLE(BITS_PER_SAMPLE)
            out.writeBytes("data")
            out.writeIntLE(dataLength)
            raw.inputStream().use { input -> input.copyTo(out) }
        }
    }

    private fun RandomAccessFile.writeIntLE(value: Int) {
        write(value and 0xff); write((value shr 8) and 0xff)
        write((value shr 16) and 0xff); write((value shr 24) and 0xff)
    }

    private fun RandomAccessFile.writeShortLE(value: Int) {
        write(value and 0xff); write((value shr 8) and 0xff)
    }
}
