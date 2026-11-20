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
            normalizePcmWav(source, destination)
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
                if (candidate.startsWith("audio/")) {
                    track = i
                    mime = candidate
                    rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    break
                }
            }
            require(track >= 0 && rate > 0 && channels in 1..2) { "Nenhuma faixa de áudio mono ou estéreo foi encontrada." }
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

    private fun normalizePcmWav(source: File, destination: File) {
        val bytes = source.readBytes()
        require(bytes.size >= 44) { "Arquivo WAV incompleto." }
        val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        require(String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 4) == "WAVE") { "Arquivo WAV inválido." }
        var formatCode = 0
        var channels = 0
        var rate = 0
        var bits = 0
        var pcmData: ByteArray? = null
        var cursor = 12
        while (cursor + 8 <= bytes.size) {
            val id = String(bytes, cursor, 4)
            val chunkSize = ByteBuffer.wrap(bytes, cursor + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
            val start = cursor + 8
            val end = (start.toLong() + chunkSize).coerceAtMost(bytes.size.toLong()).toInt()
            if (id == "fmt " && end - start >= 16) {
                formatCode = data.getShort(start).toInt() and 0xffff
                channels = data.getShort(start + 2).toInt() and 0xffff
                rate = data.getInt(start + 4)
                bits = data.getShort(start + 14).toInt() and 0xffff
            } else if (id == "data") {
                pcmData = bytes.copyOfRange(start, end)
            }
            cursor = end + (chunkSize.toInt() and 1)
        }
        val raw = pcmData ?: error("O WAV não contém dados de áudio.")
        require(formatCode == 1 || formatCode == 3) { "WAV comprimido não é suportado. Envie M4A, MP3 ou PCM WAV." }
        require(channels in 1..2 && rate > 0 && bits in listOf(8, 16, 24, 32)) { "Formato WAV não suportado." }
        require(formatCode != 3 || bits == 32) { "WAV float precisa usar 32 bits." }
        val bytesPerSample = bits / 8
        val frameBytes = bytesPerSample * channels
        val frames = raw.size / frameBytes
        val mono = ArrayList<Float>(frames)
        val pcm = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
        repeat(frames) {
            var sum = 0f
            repeat(channels) {
                val sample = when {
                    formatCode == 3 -> pcm.float
                    bits == 8 -> ((pcm.get().toInt() and 0xff) - 128) / 128f
                    bits == 16 -> pcm.short / 32768f
                    bits == 24 -> {
                        val a = pcm.get().toInt() and 0xff
                        val b = pcm.get().toInt() and 0xff
                        val c = pcm.get().toInt()
                        val value = (c shl 16) or (b shl 8) or a
                        (if (value and 0x800000 != 0) value or -0x1000000 else value) / 8388608f
                    }
                    else -> (pcm.int.toDouble() / 2147483648.0).toFloat()
                }
                sum += sample
            }
            mono.add((sum / channels).coerceIn(-1f, 1f))
        }
        require(mono.size >= rate * 5) { "A gravação precisa conter pelo menos 5 segundos de fala." }
        val normalized = if (rate == TARGET_RATE) mono.toFloatArray() else resample(mono, rate, TARGET_RATE)
        writeWav(destination, normalized)
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
