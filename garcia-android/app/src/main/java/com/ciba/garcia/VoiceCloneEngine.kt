package com.ciba.garcia

import android.content.Context
import com.ciba.garcia.chatterbox.ChatterboxNative

/** Local-only contract for voice cloning. No backend or network methods exist here. */
internal interface VoiceCloneEngine {
    fun isNativeAvailable(): Boolean
    fun areModelsInstalled(context: Context): Boolean
    fun isAvailable(context: Context): Boolean
    fun isReady(): Boolean
    fun activate(context: Context, profile: GarciaVoiceProfile, onResult: (Result<Unit>) -> Unit)
    fun restore(context: Context, onResult: (Result<Unit>) -> Unit)
    fun preview(context: Context, profile: GarciaVoiceProfile, text: String, onResult: (Result<Unit>) -> Unit)
    fun speak(context: Context, text: String, onStarted: () -> Unit, onDone: () -> Unit, onError: (Throwable) -> Unit)
    fun stop()
    fun release()
}

internal object ChatterboxVoiceCloneEngine : VoiceCloneEngine {
    override fun isNativeAvailable(): Boolean = ChatterboxNative.isLibraryLoaded()
    override fun areModelsInstalled(context: Context): Boolean = ChatterboxModelManager.installed(context) != null
    /**
     * A cold process must validate the official GGUF pair on disk. The RAM-only
     * verification stamp is an optimization, never the source of truth.
     */
    override fun isAvailable(context: Context): Boolean {
        if (!isNativeAvailable()) return false
        if (isReady() || ClonedVoiceRuntime.isLoading()) return true
        return areModelsInstalled(context)
    }
    override fun isReady(): Boolean = ClonedVoiceRuntime.isReady()

    override fun activate(context: Context, profile: GarciaVoiceProfile, onResult: (Result<Unit>) -> Unit) {
        if (!isNativeAvailable()) {
            onResult(Result.failure(IllegalStateException("O runtime nativo de clonagem não está disponível nesta versão do Android.")))
            return
        }
        if (!isAvailable(context)) {
            onResult(Result.failure(IllegalStateException("Os modelos locais de clonagem ainda não foram validados neste processo.")))
            return
        }
        ClonedVoiceRuntime.activate(context, profile, onResult)
    }

    override fun restore(context: Context, onResult: (Result<Unit>) -> Unit) {
        if (!isNativeAvailable()) {
            onResult(Result.failure(IllegalStateException("O runtime nativo de clonagem não está disponível nesta versão do Android.")))
            return
        }
        ClonedVoiceRuntime.restore(context, onResult)
    }

    override fun preview(context: Context, profile: GarciaVoiceProfile, text: String, onResult: (Result<Unit>) -> Unit) {
        if (!isAvailable(context)) {
            onResult(Result.failure(IllegalStateException("Instale e valide os modelos locais Chatterbox antes de ouvir a voz clonada.")))
            return
        }
        ClonedVoiceRuntime.preview(context, profile, text, onResult)
    }

    override fun speak(context: Context, text: String, onStarted: () -> Unit, onDone: () -> Unit, onError: (Throwable) -> Unit) {
        if (!isAvailable(context)) {
            onError(IllegalStateException("A voz clonada está selecionada, mas o runtime ou os modelos locais não estão disponíveis. Nenhuma voz substituta será usada."))
            return
        }
        ClonedVoiceRuntime.speak(context, text, onStarted, onDone, onError)
    }

    override fun stop() = ClonedVoiceRuntime.stop()
    override fun release() = ClonedVoiceRuntime.release()
}
