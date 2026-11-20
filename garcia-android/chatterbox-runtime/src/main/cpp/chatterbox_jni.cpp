#include <jni.h>
#include <android/log.h>
#include <tts-cpp/chatterbox/engine.h>

#include <algorithm>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr const char * TAG = "GarciaChatterbox";
std::mutex g_mutex;
std::shared_ptr<tts_cpp::chatterbox::Engine> g_engine;

std::string toString(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const char * chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

void throwState(JNIEnv * env, const std::string & message) {
    jclass cls = env->FindClass("java/lang/IllegalStateException");
    if (cls != nullptr) env->ThrowNew(cls, message.c_str());
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ciba_garcia_chatterbox_ChatterboxNative_nativeCreate(
        JNIEnv * env, jclass, jstring t3Path, jstring s3Path,
        jstring referenceWav, jstring voiceDirectory, jstring language) {
    const std::string t3 = toString(env, t3Path);
    const std::string s3 = toString(env, s3Path);
    const std::string reference = toString(env, referenceWav);
    const std::string voiceDir = toString(env, voiceDirectory);
    const std::string lang = toString(env, language);
    if (t3.empty() || s3.empty()) {
        throwState(env, "Arquivos dos modelos Chatterbox não foram informados.");
        return JNI_FALSE;
    }

    try {
        tts_cpp::chatterbox::EngineOptions options;
        options.t3_gguf_path = t3;
        options.s3gen_gguf_path = s3;
        options.reference_audio = reference;
        if (!reference.empty()) options.save_voice_dir = voiceDir;
        else options.voice_dir = voiceDir;
        options.language = lang.empty() ? "pt" : lang;
        options.n_threads = std::max(1, std::min(4, (int)std::thread::hardware_concurrency()));
        options.n_predict = 700;
        options.temperature = 0.8f;
        options.cfg_weight = 0.5f;
        options.min_p = 0.05f;
        options.exaggeration = 0.5f;
        options.mtl_top_p = 1.0f;
        options.mtl_repeat_penalty = 2.0f;

        auto candidate = std::make_shared<tts_cpp::chatterbox::Engine>(options);
        std::lock_guard<std::mutex> lock(g_mutex);
        g_engine = std::move(candidate);
        __android_log_print(ANDROID_LOG_INFO, TAG, "Multilingual Chatterbox engine loaded.");
        return JNI_TRUE;
    } catch (const std::exception & error) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "Engine load failed (details withheld).");
        throwState(env, std::string("Falha ao carregar o motor local de voz: ") + error.what());
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_ciba_garcia_chatterbox_ChatterboxNative_nativeSynthesize(
        JNIEnv * env, jclass, jstring inputText) {
    const std::string text = toString(env, inputText);
    if (text.empty()) {
        throwState(env, "O texto para síntese está vazio.");
        return nullptr;
    }
    try {
        std::shared_ptr<tts_cpp::chatterbox::Engine> engine;
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            engine = g_engine;
        }
        if (!engine) {
            throwState(env, "O mecanismo Chatterbox ainda não foi carregado.");
            return nullptr;
        }
        const auto result = engine->synthesize(text);
        if (result.pcm.empty()) {
            throwState(env, "O Chatterbox não gerou áudio.");
            return nullptr;
        }
        jfloatArray output = env->NewFloatArray((jsize)result.pcm.size());
        if (output == nullptr) return nullptr;
        env->SetFloatArrayRegion(output, 0, (jsize)result.pcm.size(), result.pcm.data());
        return output;
    } catch (const std::exception & error) {
        throwState(env, std::string("Falha durante a síntese local de voz: ") + error.what());
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_chatterbox_ChatterboxNative_nativeCancel(JNIEnv *, jclass) {
    std::shared_ptr<tts_cpp::chatterbox::Engine> engine;
    { std::lock_guard<std::mutex> lock(g_mutex); engine = g_engine; }
    if (engine) engine->cancel();
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_chatterbox_ChatterboxNative_nativeRelease(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_engine.reset();
}
