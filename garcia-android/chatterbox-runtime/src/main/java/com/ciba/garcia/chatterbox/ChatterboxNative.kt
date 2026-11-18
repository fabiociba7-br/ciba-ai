package com.ciba.garcia.chatterbox

object ChatterboxNative {
    init { System.loadLibrary("garcia_chatterbox") }

    @JvmStatic external fun nativeCreate(
        t3Path: String,
        s3Path: String,
        referenceWav: String,
        voiceDirectory: String,
        language: String = "pt"
    ): Boolean

    @JvmStatic external fun nativeSynthesize(text: String): FloatArray
    @JvmStatic external fun nativeCancel()
    @JvmStatic external fun nativeRelease()
}
