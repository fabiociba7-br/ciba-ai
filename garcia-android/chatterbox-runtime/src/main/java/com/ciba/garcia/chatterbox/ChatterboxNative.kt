package com.ciba.garcia.chatterbox

object ChatterboxNative {
    private val loadFailure: Throwable? = runCatching { System.loadLibrary("garcia_chatterbox") }.exceptionOrNull()

    @JvmStatic fun isLibraryLoaded(): Boolean = loadFailure == null

    @JvmStatic fun libraryStatus(): String =
        if (loadFailure == null) "Runtime nativo carregado."
        else "Runtime nativo Chatterbox indisponível para esta arquitetura."

    @JvmStatic external fun nativeCreate(t3Path: String, s3Path: String, referenceWav: String, voiceDirectory: String, language: String): Boolean
    @JvmStatic external fun nativeSynthesize(text: String): FloatArray
    @JvmStatic external fun nativeCancel()
    @JvmStatic external fun nativeRelease()
}
