#include <jni.h>
#include <android/log.h>
#include <stable-diffusion.h>

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr const char* TAG = "GarciaImage";
std::mutex g_mutex;
sd_ctx_t* g_context = nullptr;

void throwState(JNIEnv* env, const std::string& message) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    if (type) env->ThrowNew(type, message.c_str());
}

bool setString(sd_opt_t* options, const char* key, const char* value) {
    const auto status = sd_opt_set_string(options, key, value);
    if (status == SD_STATUS_OK) return true;
    __android_log_print(ANDROID_LOG_ERROR, TAG, "Option %s: %s", key, sd_get_last_error());
    return false;
}

bool setInt(sd_opt_t* options, const char* key, int64_t value) {
    const auto status = sd_opt_set_int(options, key, value);
    if (status == SD_STATUS_OK) return true;
    __android_log_print(ANDROID_LOG_ERROR, TAG, "Option %s: %s", key, sd_get_last_error());
    return false;
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ciba_garcia_LocalImageNative_nativeLoadModel(JNIEnv* env, jobject, jstring modelPath) {
    if (!modelPath) {
        throwState(env, "Selecione um modelo de geração de imagens.");
        return JNI_FALSE;
    }
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    if (!path) return JNI_FALSE;

    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_context) {
        sd_ctx_free(g_context);
        g_context = nullptr;
    }

    sd_ctx_opt_t* options = sd_ctx_opt_create();
    const unsigned int cores = std::thread::hardware_concurrency();
    const int threads = std::max(2, std::min(6, static_cast<int>(cores > 1 ? cores - 1 : 2)));
    bool configured = options && setString(options, "model_path", path)
        && setInt(options, "n_threads", threads);
    if (configured) {
        const sd_status_t status = sd_ctx_create(options, &g_context);
        if (status != SD_STATUS_OK) {
            const char* error = sd_get_last_error();
            throwState(env, error ? error : "Não foi possível carregar o modelo de imagens.");
        } else if (!sd_ctx_supports_image_generation(g_context)) {
            sd_ctx_free(g_context);
            g_context = nullptr;
            throwState(env, "O arquivo selecionado não oferece geração de imagens compatível.");
        }
    } else if (!options) {
        throwState(env, "Não foi possível inicializar o mecanismo de imagens.");
    } else {
        const char* error = sd_get_last_error();
        throwState(env, error ? error : "Configuração do modelo inválida.");
    }

    sd_opt_free(options);
    env->ReleaseStringUTFChars(modelPath, path);
    return g_context ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jintArray JNICALL
Java_com_ciba_garcia_LocalImageNative_nativeGenerate(
    JNIEnv* env, jobject, jstring prompt, jstring negativePrompt,
    jint width, jint height, jint steps, jlong seed) {
    if (!prompt || width < 256 || width > 768 || height < 256 || height > 768 ||
        steps < 1 || steps > 40) {
        throwState(env, "Parâmetros de geração inválidos. Use dimensões entre 256 e 768 e até 40 etapas.");
        return nullptr;
    }
    const char* promptText = env->GetStringUTFChars(prompt, nullptr);
    const char* negativeText = negativePrompt ? env->GetStringUTFChars(negativePrompt, nullptr) : nullptr;
    if (!promptText) return nullptr;

    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_context) {
        if (negativeText) env->ReleaseStringUTFChars(negativePrompt, negativeText);
        env->ReleaseStringUTFChars(prompt, promptText);
        throwState(env, "Carregue um modelo local antes de gerar imagens.");
        return nullptr;
    }

    sd_img_gen_opt_t* options = sd_img_gen_opt_create();
    sd_result_t* result = nullptr;
    bool configured = options && setString(options, "prompt", promptText)
        && setInt(options, "width", width) && setInt(options, "height", height)
        && setInt(options, "sample.steps", steps) && setInt(options, "seed", seed);
    if (configured && negativeText && *negativeText) {
        configured = setString(options, "negative_prompt", negativeText);
    }
    sd_status_t status = configured ? sd_generate_image(g_context, options, &result) : SD_STATUS_INVALID_ARGUMENT;
    jintArray output = nullptr;

    if (status == SD_STATUS_OK && result && sd_result_get_image_count(result) > 0) {
        const sd_tensor_t* image = sd_result_get_image(result, 0);
        const int64_t channels = sd_tensor_dim(image, 0);
        const int64_t imageWidth = sd_tensor_dim(image, 1);
        const int64_t imageHeight = sd_tensor_dim(image, 2);
        const auto* rgb = static_cast<const uint8_t*>(sd_tensor_data(image));
        if (channels >= 3 && imageWidth > 0 && imageHeight > 0 &&
            imageWidth * imageHeight <= 768LL * 768LL && rgb) {
            const jsize pixelCount = static_cast<jsize>(imageWidth * imageHeight);
            std::vector<jint> pixels(static_cast<size_t>(pixelCount) + 2);
            pixels[0] = static_cast<jint>(imageWidth);
            pixels[1] = static_cast<jint>(imageHeight);
            for (jsize i = 0; i < pixelCount; ++i) {
                const size_t offset = static_cast<size_t>(i) * static_cast<size_t>(channels);
                const uint32_t red = rgb[offset];
                const uint32_t green = rgb[offset + 1];
                const uint32_t blue = rgb[offset + 2];
                pixels[static_cast<size_t>(i) + 2] = static_cast<jint>(
                    0xFF000000u | (red << 16) | (green << 8) | blue);
            }
            output = env->NewIntArray(static_cast<jsize>(pixels.size()));
            if (output) env->SetIntArrayRegion(output, 0, static_cast<jsize>(pixels.size()), pixels.data());
        } else {
            throwState(env, "O mecanismo retornou uma imagem em formato inesperado.");
        }
    } else {
        const char* error = sd_get_last_error();
        throwState(env, error ? error : "Falha ao gerar a imagem no aparelho.");
    }

    sd_result_free(result);
    sd_opt_free(options);
    if (negativeText) env->ReleaseStringUTFChars(negativePrompt, negativeText);
    env->ReleaseStringUTFChars(prompt, promptText);
    return output;
}

extern "C" JNIEXPORT void JNICALL
Java_com_ciba_garcia_LocalImageNative_nativeReleaseModel(JNIEnv*, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_context) {
        sd_ctx_free(g_context);
        g_context = nullptr;
    }
}
