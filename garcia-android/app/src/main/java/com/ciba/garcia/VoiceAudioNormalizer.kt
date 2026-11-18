package com.ciba.garcia

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor

internal object VoiceAudioNormalizer {
    private const val TARGET_RATE = 24_000

    fun toMonoWav(source: File, destination: File) {
        require(source.isFile && source.length() > 1024) { "Amostra de voz inválida." }
        if (source.extension.equals("wav", true)) {
            source.copyTo(destination, overwrite = true)
            validateWav(destination)
            return
        }
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        val samples = ArrayList<Float>()
        var rate = 24_000
        var channels = 1
        try {
            extractor.setDataSource(source.absolutePath)
            var track = -1
            var mime = ""
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val candidate = format.getString(MediaFormat.KEY_MIME).orEmpty()
                if (candidate.startsWith("audio/")) { track = i; mime = candidate; break }
            }
            require(track >= 0) { "Nenhuma faixa de áudio foi encontrada." }
            extractor.selectTrack(track)
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(extractor.getTrackFormat(track), null, null, 0)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var encoding = android.media.AudioFormat.ENCODING_PCM_16BIT
            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = codec.getInputBuffer(inputIndex)!!
                        input.clear()
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val format = codec.outputFormat
                        rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING))
                            format.getInteger(MediaFormat.KEY_PCM_ENCODING)
                        else android.media.AudioFormat.ENCODING_PCM_16BIT
                        require(channels in 1..2) { "Amostra deve ter no máximo dois canais." }
                    }
                    outputIndex >= 0 -> {
                        if (info.size > 0) {
                            val out = codec.getOutputBuffer(outputIndex)!!
                            out.position(info.offset); out.limit(info.offset + info.size)
                            decode(out.slice().order(ByteOrder.LITTLE_ENDIAN), encoding, channels, samples)
                        }
                        outputDone = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                        codec.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }
            require(samples.size >= rate * 5) { "A gravação precisa conter pelo menos 5 segundos de fala." }
            val pcm = if (rate == TARGET_RATE) samples.toFloatArray() else resample(samples, rate, TARGET_RATE)
            writeWav(destination, pcm)
        } finally {
            runCatching { codec?.stop() }; codec?.release(); extractor.release()
        }
    }

    private fun decode(buffer: ByteBuffer, encoding: Int, channels: Int, out: MutableList<Float>) {
        val bytes = when (encoding) {
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> 4
            android.media.AudioFormat.ENCODING_PCM_8BIT -> 1
            else -> 2
        }
        while (buffer.remaining() >= bytes * channels) {
            var sum = 0f
            repeat(channels) {
                sum += when (encoding) {
                    android.media.AudioFormat.ENCODING_PCM_FLOAT -> buffer.float
                    android.media.AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get().toInt() and 255) - 128) / 128f
                    else -> buffer.short / 32768f
                }
            }
            out.add((sum / channels).coerceIn(-1f, 1f))
        }
    }

    private fun resample(input: List<Float>, from: Int, to: Int): FloatArray {
        val count = floor(input.size.toDouble() * to / from).toInt().coerceAtLeast(1)
        return FloatArray(count) { i ->
            val p = i.toDouble() * from / to
            val a = p.toInt().coerceIn(0, input.lastIndex)
            val b = (a + 1).coerceAtMost(input.lastIndex)
            val f = (p - a).toFloat()
            input[a] * (1f - f) + input[b] * f
        }
    }

    private fun writeWav(file: File, pcm: FloatArray) {
        val size = pcm.size * 2
        FileOutputStream(file).use { stream ->
            val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            h.put("RIFF".toByteArray()); h.putInt(36 + size); h.put("WAVE".toByteArray())
            h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1)
            h.putInt(TARGET_RATE); h.putInt(TARGET_RATE * 2); h.putShort(2); h.putShort(16)
            h.put("data".toByteArray()); h.putInt(size); stream.write(h.array())
            val chunk = ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN)
            for (sample in pcm) {
                if (chunk.remaining() < 2) { stream.write(chunk.array(), 0, chunk.position()); chunk.clear() }
                chunk.putShort((sample * 32767f).toInt().coerceIn(-32768, 32767).toShort())
            }
            if (chunk.position() > 0) stream.write(chunk.array(), 0, chunk.position())
        }
    }

    private fun validateWav(file: File) {
        file.inputStream().use {
            val b = ByteArray(12)
            require(it.read(b) == 12 && String(b, 0, 4) == "RIFF" && String(b, 8, 4) == "WAVE") {
                "O arquivo WAV não é válido."
            }
        }
    }
}
