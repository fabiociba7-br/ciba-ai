package com.ciba.garcia.voice.pockettts

import android.content.ContentResolver
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Decodes audio supported by Android's platform codecs and normalizes it to
 * the exact PCM WAV profile consumed by PocketTtsVoiceProfileManager.
 */
internal object PocketTtsAudioImporter {
    private const val TARGET_RATE = 24_000
    private const val TARGET_CHANNELS = 1
    private const val MAX_SECONDS = 30
    private const val MIN_SECONDS = 3
    private const val MAX_OUTPUT_BYTES = 8 * 1024 * 1024

    fun decodeToPcmWav(resolver: ContentResolver, uri: Uri): ByteArray {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var descriptor: android.os.ParcelFileDescriptor? = null
        try {
            // Keep the descriptor open for the entire extractor lifetime. MediaExtractor
            // may continue reading from the FD after setDataSource() returns.
            descriptor = resolver.openFileDescriptor(uri, "r")
                ?: throw IllegalArgumentException("Não foi possível abrir o áudio selecionado.")
            extractor.setDataSource(descriptor.fileDescriptor)

            var audioTrack = -1
            var inputFormat: MediaFormat? = null
            for (index in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(index)
                val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
                if (mime.startsWith("audio/")) {
                    audioTrack = index
                    inputFormat = format
                    break
                }
            }
            val format = inputFormat ?: throw IllegalArgumentException("O arquivo não contém uma faixa de áudio compatível.")
            val mime = format.getString(MediaFormat.KEY_MIME)
                ?: throw IllegalArgumentException("Formato de áudio não identificado.")
            extractor.selectTrack(audioTrack)
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()

            val decoded = ByteArrayOutputStream()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var outputRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var outputChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var pcmEncoding = 2 // AudioFormat.ENCODING_PCM_16BIT
            var totalDecodedBytes = 0L
            var guard = 0

            while (!outputDone && guard++ < 100_000) {
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val inputBuffer = codec.getInputBuffer(inputIndex)
                            ?: throw IllegalStateException("Falha ao acessar buffer de entrada do decodificador.")
                        val sampleSize = extractor.readSampleData(inputBuffer, 0)
                        if (sampleSize < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inputIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                when (val outputIndex = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val out = codec.outputFormat
                        outputRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        outputChannels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        pcmEncoding = if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                            out.getInteger(MediaFormat.KEY_PCM_ENCODING)
                        } else 2
                    }
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    else -> if (outputIndex >= 0) {
                        val outputBuffer = codec.getOutputBuffer(outputIndex)
                        if (outputBuffer != null && info.size > 0) {
                            outputBuffer.position(info.offset)
                            outputBuffer.limit(info.offset + info.size)
                            val chunk = ByteArray(info.size)
                            outputBuffer.get(chunk)
                            decoded.write(chunk)
                            totalDecodedBytes += chunk.size
                            if (totalDecodedBytes > 64L * 1024 * 1024) {
                                throw IllegalArgumentException("O áudio decodificado é muito grande. Use uma amostra menor.")
                            }
                        }
                        outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        codec.releaseOutputBuffer(outputIndex, false)
                    }
                }
            }
            if (!outputDone) throw IllegalArgumentException("O decodificador não conseguiu concluir a leitura do áudio.")
            if (outputRate <= 0 || outputChannels !in 1..8) {
                throw IllegalArgumentException("O áudio possui parâmetros de canais ou frequência inválidos.")
            }
            val mono = toMonoFloat(decoded.toByteArray(), pcmEncoding, outputChannels)
            val normalized = resample(mono, outputRate, TARGET_RATE)
            val maxSamples = TARGET_RATE * MAX_SECONDS
            val bounded = normalized.take(maxSamples).toFloatArray()
            val duration = bounded.size.toFloat() / TARGET_RATE
            require(duration >= MIN_SECONDS) {
                "A amostra precisa ter pelo menos 3 segundos (áudio recebido: %.1f s).".format(duration)
            }
            val wav = makeWav(bounded)
            require(wav.size <= MAX_OUTPUT_BYTES) {
                "O áudio convertido excede 8 MB. Escolha um trecho mais curto."
            }
            return wav
        } catch (error: IllegalArgumentException) {
            throw error
        } catch (error: Exception) {
            throw IllegalArgumentException("Não foi possível decodificar este áudio. Tente WAV, MP3, M4A ou AAC.", error)
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            runCatching { extractor.release() }
            runCatching { descriptor?.close() }
        }
    }

    private fun toMonoFloat(bytes: ByteArray, encoding: Int, channels: Int): FloatArray {
        val bytesPerSample = when (encoding) {
            2 -> 2 // PCM 16-bit
            3 -> 1 // PCM 8-bit
            4 -> 4 // PCM float
            else -> throw IllegalArgumentException("O decodificador retornou um formato PCM não suportado.")
        }
        val frameBytes = bytesPerSample * channels
        val frameCount = bytes.size / frameBytes
        require(frameCount > 0) { "O arquivo não contém amostras de áudio." }
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(frameCount) { frame ->
            var sum = 0f
            repeat(channels) { channel ->
                val index = frame * channels + channel
                val sample = when (encoding) {
                    2 -> buffer.getShort(index * 2).toFloat() / 32768f
                    3 -> ((bytes[index].toInt() and 0xff) - 128) / 128f
                    4 -> buffer.getFloat(index * 4).coerceIn(-1f, 1f)
                    else -> 0f
                }
                sum += sample
            }
            (sum / channels).coerceIn(-1f, 1f)
        }
    }

    private fun resample(input: FloatArray, sourceRate: Int, targetRate: Int): FloatArray {
        if (sourceRate == targetRate) return input
        val outputSize = max(1, floor(input.size.toDouble() * targetRate / sourceRate).toInt())
        return FloatArray(outputSize) { index ->
            val position = index.toDouble() * sourceRate / targetRate
            val left = min(input.lastIndex, floor(position).toInt())
            val right = min(input.lastIndex, left + 1)
            val fraction = (position - left).toFloat()
            input[left] * (1f - fraction) + input[right] * fraction
        }
    }

    private fun makeWav(samples: FloatArray): ByteArray {
        val dataSize = samples.size * 2
        val buffer = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray(Charsets.US_ASCII))
        buffer.putInt(36 + dataSize)
        buffer.put("WAVE".toByteArray(Charsets.US_ASCII))
        buffer.put("fmt ".toByteArray(Charsets.US_ASCII))
        buffer.putInt(16)
        buffer.putShort(1)
        buffer.putShort(TARGET_CHANNELS.toShort())
        buffer.putInt(TARGET_RATE)
        buffer.putInt(TARGET_RATE * 2)
        buffer.putShort(2)
        buffer.putShort(16)
        buffer.put("data".toByteArray(Charsets.US_ASCII))
        buffer.putInt(dataSize)
        samples.forEach { sample ->
            val scaled = (sample.coerceIn(-1f, 1f) * 32767f).toInt()
            buffer.putShort(scaled.toShort())
        }
        return buffer.array()
    }
}
