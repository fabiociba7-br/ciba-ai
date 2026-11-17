#include <jni.h>
#include <android/log.h>
#include <whisper.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <sstream>
#include <string>

namespace {
constexpr const char * kTag = "GarciaWhisper";
constexpr jsize kMaxSamples = 16000 * 120;
std::mutex g_mutex;
whisper_context * g_context = nullptr;
std::atomic<bool> g_cancelled{false};

bool abortWhisper(void *) {
    return g_cancelled.load(std::memory_order_relaxed);
}

void throwIllegalState(JNIEnv * env, const char * message) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    if (type != nullptr) env->ThrowNew(type, message);
}

std::string escapeJson(const char * value) {
    std::string out;
    if (value == nullptr) return out;
    for (const unsigned char ch : std::string(value)) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch >= 0x20) out += static_cast<char>(ch);
                break;
        }
    }
    return out;
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ciba_garcia_WhisperNative_nativeLoadModel(
        JNIEnv * env, jobject, jstring modelPath) {
    if (modelPath == nullptr) {
        throwIllegalState(env, "Caminho do modelo Whisper ausente.");
        return JNI_FALSE;
    }
    const char * path = env->GetStringUTFChars(modelPath, nullptr);
    if (path == nullptr) return JNI_FALSE;

    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_context != nullptr) {
        whisper_free(g_context);
        g_context = nullptr;
    }
    g_cancelled.store(false, std::memory_order_relaxed);
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    g_context = whisper_init_from_file_with_params(path, params);
    env->ReleaseStringUTFChars(modelPath, path);

    if (g_context == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, kTag, "Falha ao carregar o modelo Whisper.");
        return JNI_FALSE;
    }
    __android_log_print(ANDROID_LOG_INFO, kTag, "Modelo Whisper carregado.");
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_ciba_garcia_WhisperNative_nativeTranscribe(
        JNIEnv * env, jobject, jfloatArray audio, jstring language, jint threads) {
    if (audio == nullptr || language == nullptr) {
        throwIllegalState(env, "Áudio ou idioma ausente.");
        return nullptr;
    }
    const jsize count = env->GetArrayLength(audio);
    if (count < 1600 || count > kMaxSamples) {
        throwIllegalState(env, "A gravação deve ter entre 0,1 e 120 segundos.");
        return nullptr;
    }

    const char * languageCode = env->GetStringUTFChars(language, nullptr);
    if (languageCode == nullptr) return nullptr;
    jboolean copied = JNI_FALSE;
    jfloat * samples = env->GetFloatArrayElements(audio, &copied);
    if (samples == nullptr) {
        env->ReleaseStringUTFChars(language, languageCode);
        return nullptr;
    }

    std::string json;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (g_context == nullptr) {
            env->ReleaseFloatArrayElements(audio, samples, JNI_ABORT);
            env->ReleaseStringUTFChars(language, languageCode);
            throwIllegalState(env, "O modelo Whisper ainda não foi carregado.");
            return nullptr;
        }

        g_cancelled.store(false, std::memory_order_relaxed);
        whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.language = languageCode;
        params.translate = false;
        params.no_context = true;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_timestamps = false;
        params.n_threads = std::max(1, std::min(static_cast<int>(threads), 8));
        params.abort_callback = abortWhisper;

        const int status = whisper_full(g_context, params, samples, count);
        if (status != 0 || g_cancelled.load(std::memory_order_relaxed)) {
            env->ReleaseFloatArrayElements(audio, samples, JNI_ABORT);
            env->ReleaseStringUTFChars(language, languageCode);
            throwIllegalState(env, g_cancelled.load() ? "Transcrição cancelada." : "Falha na transcrição Whisper.");
            return nullptr;
        }

        const int segments = whisper_full_n_segments(g_context);
        const char * detected = whisper_lang_str(whisper_full_lang_id(g_context));
        std::ostringstream out;
        out << "{\\"engine\\":\\"whisper.cpp\\",\\"language\\":\\""
            << escapeJson(detected) << "\\",\\"segments\\":[";
        std::string fullText;
        for (int i = 0; i < segments; ++i) {
            const char * rawText = whisper_full_get_segment_text(g_context, i);
            const std::string segment = rawText == nullptr ? "" : rawText;
            if (i > 0) {
                out << ",";
                fullText += " ";
            }
            const auto startMs = whisper_full_get_segment_t0(g_context, i) * 10;
            const auto endMs = whisper_full_get_segment_t1(g_context, i) * 10;
            out << "{\\"startMs\\":" << startMs
                << ",\\"endMs\\":" << endMs
                << ",\\"text\\":\\"" << escapeJson(segment.c_str()) << "\\"}";
            fullText += segment;
        }
        out << "],\\"text\\":\\"" << escapeJson(fullText.c_str()) << "\\"}";
        json = out.str();
    }

    env->ReleaseFloatArrayElements(audio, samples, JNI_ABORT);
    env->ReleaseStringUTFChars(language, languageCode);
    return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_WhisperNative_nativeCancel(JNIEnv *, jobject) {
    g_cancelled.store(true, std::memory_order_relaxed);
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_WhisperNative_nativeRelease(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_context != nullptr) {
        whisper_free(g_context);
        g_context = nullptr;
    }
    g_cancelled.store(false, std::memory_order_relaxed);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ciba_garcia_WhisperNative_nativeIsModelLoaded(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    return g_context != nullptr ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_ciba_garcia_WhisperNative_nativeEngineVersion(JNIEnv * env, jobject) {
    return env->NewStringUTF(whisper_print_system_info());
}
