package com.ciba.garcia

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import java.io.File

/** Local, non-streaming Parakeet TDT recognizer for Brazilian Portuguese. */
internal class ParakeetAsrEngine {
    @Volatile private var recognizer: OfflineRecognizer? = null

    val isReady: Boolean get() = recognizer != null

    @Synchronized
    fun load(modelDirectory: File, threads: Int = 2) {
        release()
        val encoder = File(modelDirectory, "encoder.int8.onnx")
        val decoder = File(modelDirectory, "decoder.int8.onnx")
        val joiner = File(modelDirectory, "joiner.int8.onnx")
        val tokens = File(modelDirectory, "tokens.txt")
        require(listOf(encoder, decoder, joiner, tokens).all { it.isFile }) {
            "O pacote Parakeet PT-BR está incompleto."
        }
        val transducer = OfflineTransducerModelConfig.builder()
            .setEncoder(encoder.absolutePath)
            .setDecoder(decoder.absolutePath)
            .setJoiner(joiner.absolutePath)
            .build()
        val model = OfflineModelConfig.builder()
            .setTransducer(transducer)
            .setTokens(tokens.absolutePath)
            .setModelType("nemo_transducer")
            .setNumThreads(threads.coerceIn(1, 4))
            .setDebug(false)
            .build()
        val config = OfflineRecognizerConfig.builder()
            .setFeatureConfig(FeatureConfig.builder().setSampleRate(16_000).setFeatureDim(128).build())
            .setOfflineModelConfig(model)
            .setDecodingMethod("greedy_search")
            .build()
        recognizer = OfflineRecognizer(config)
    }

    @Synchronized
    fun transcribe(samples: FloatArray): String {
        val active = recognizer ?: throw IllegalStateException("O modelo Parakeet PT-BR não está carregado.")
        require(samples.size >= 1_600) { "Gravação muito curta. Fale por pelo menos um segundo." }
        val stream: OfflineStream = active.createStream()
        return try {
            stream.acceptWaveform(samples, 16_000)
            active.decode(stream)
            active.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    @Synchronized
    fun release() {
        recognizer?.release()
        recognizer = null
    }
}
