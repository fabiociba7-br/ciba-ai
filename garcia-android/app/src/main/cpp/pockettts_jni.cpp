#include <jni.h>
#include <atomic>
#include <limits>
#include <mutex>
#include <new>
#include <string>

extern "C" {
void* ptt_create(const char*, const char*, const char*, const char*, float, int, int, int, int);
void ptt_destroy(void*);
void* ptt_stream_start(void*, const char*, const char*);
int ptt_stream_read(void*, float**, int*);
void ptt_stream_cancel(void*);
void ptt_stream_end(void*);
void ptt_free_audio(float*);
}

struct PocketEngine {
    void* tts = nullptr;
    void* stream = nullptr;
    std::mutex synth_mutex;
    std::mutex stream_mutex;
    std::atomic<bool> cancel_requested{false};
};

static PocketEngine* engine_from(jlong value) {
    return reinterpret_cast<PocketEngine*>(value);
}

static bool copy_string(JNIEnv* env, jstring value, std::string& out) {
    if (value == nullptr) return false;
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return false; // JVM has a pending allocation exception.
    out.assign(chars);
    env->ReleaseStringUTFChars(value, chars);
    return true;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_ciba_garcia_voice_pockettts_NativePocketTts_nativeCreate(
        JNIEnv* env, jobject, jstring models, jstring voices, jstring precision,
        jfloat temperature, jint lsd_steps, jint threads, jint sentence_pause_ms,
        jint max_text_tokens) {
    std::string model_path, voice_path, precision_value;
    if (!copy_string(env, models, model_path) ||
        !copy_string(env, voices, voice_path) ||
        !copy_string(env, precision, precision_value)) return 0;

    auto* engine = new (std::nothrow) PocketEngine();
    if (!engine) return 0;
    const std::string tokenizer_path = model_path + "/tokenizer.model";
    engine->tts = ptt_create(model_path.c_str(), voice_path.c_str(), tokenizer_path.c_str(),
        precision_value.c_str(), temperature, lsd_steps, threads, sentence_pause_ms, max_text_tokens);
    if (!engine->tts) {
        delete engine;
        return 0;
    }
    return reinterpret_cast<jlong>(engine);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ciba_garcia_voice_pockettts_NativePocketTts_nativeSynthesize(
        JNIEnv* env, jobject, jlong value, jstring text, jstring voice, jobject sink) {
    auto* engine = engine_from(value);
    if (!engine || !engine->tts || sink == nullptr) return JNI_FALSE;

    std::lock_guard<std::mutex> synth_guard(engine->synth_mutex);
    std::string utf8, voice_utf8;
    if (!copy_string(env, text, utf8) || !copy_string(env, voice, voice_utf8)) return JNI_FALSE;

    engine->cancel_requested.store(false);
    void* stream = ptt_stream_start(engine->tts, utf8.c_str(), voice_utf8.c_str());
    if (!stream) return JNI_FALSE;
    {
        std::lock_guard<std::mutex> stream_guard(engine->stream_mutex);
        engine->stream = stream;
        if (engine->cancel_requested.load()) ptt_stream_cancel(stream);
    }

    jclass sink_class = env->GetObjectClass(sink);
    jmethodID on_audio = sink_class ? env->GetMethodID(sink_class, "onAudio", "([F)Z") : nullptr;
    bool success = on_audio != nullptr && !env->ExceptionCheck();

    while (success) {
        float* samples = nullptr;
        int count = 0;
        const int state = ptt_stream_read(stream, &samples, &count);
        if (state == 0) break;
        if (state < 0 || count <= 0 || count > std::numeric_limits<jsize>::max() || samples == nullptr) {
            if (samples) ptt_free_audio(samples);
            success = false;
            break;
        }

        jfloatArray chunk = env->NewFloatArray(static_cast<jsize>(count));
        if (!chunk) {
            ptt_free_audio(samples);
            success = false;
            break;
        }
        env->SetFloatArrayRegion(chunk, 0, static_cast<jsize>(count), samples);
        ptt_free_audio(samples);
        if (env->ExceptionCheck()) {
            env->DeleteLocalRef(chunk);
            success = false;
            break;
        }
        const jboolean accepted = env->CallBooleanMethod(sink, on_audio, chunk);
        env->DeleteLocalRef(chunk);
        if (env->ExceptionCheck() || !accepted) {
            success = false;
            break;
        }
    }

    if (sink_class) env->DeleteLocalRef(sink_class);
    {
        std::lock_guard<std::mutex> stream_guard(engine->stream_mutex);
        if (engine->stream == stream) engine->stream = nullptr;
        ptt_stream_end(stream);
    }
    engine->cancel_requested.store(false);
    return success ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_voice_pockettts_NativePocketTts_nativeStop(
        JNIEnv*, jobject, jlong value) {
    auto* engine = engine_from(value);
    if (!engine) return;
    engine->cancel_requested.store(true);
    std::lock_guard<std::mutex> stream_guard(engine->stream_mutex);
    if (engine->stream) ptt_stream_cancel(engine->stream);
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_voice_pockettts_NativePocketTts_nativeDestroy(
        JNIEnv*, jobject, jlong value) {
    auto* engine = engine_from(value);
    if (!engine) return;
    engine->cancel_requested.store(true);
    {
        std::lock_guard<std::mutex> stream_guard(engine->stream_mutex);
        if (engine->stream) ptt_stream_cancel(engine->stream);
    }
    std::lock_guard<std::mutex> synth_guard(engine->synth_mutex);
    ptt_destroy(engine->tts);
    engine->tts = nullptr;
    delete engine;
}
