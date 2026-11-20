cmake_minimum_required(VERSION 3.22.1)
project(garcia_native_engines LANGUAGES C CXX)

include(FetchContent)

# Existing local ASR engine (Whisper.cpp).
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(whisper_cpp
    GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
    GIT_TAG d1be6fde11ac6e0407606b4e42fe72d34add8037
    GIT_SHALLOW FALSE)
FetchContent_MakeAvailable(whisper_cpp)

add_library(garcia_whisper SHARED whisper_jni.cpp)
target_compile_features(garcia_whisper PRIVATE cxx_std_17)
target_compile_options(garcia_whisper PRIVATE -O3 -fvisibility=hidden)
target_link_libraries(garcia_whisper PRIVATE whisper android log)

# Pocket TTS native runtime: ARM64 only until another ABI is independently validated.
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(POCKET_DEPS "${CMAKE_BINARY_DIR}/pockettts_deps")
    set(ORT_VERSION "1.20.0")
    set(ORT_AAR "${POCKET_DEPS}/onnxruntime-android-${ORT_VERSION}.aar")
    set(ORT_AAR_SHA256 "07a8f71ef890afed8c6087a56220e6d558a492804276ee2dd7cb7f6262242027")
    # Fetch the exact ONNX Runtime source tag for C/C++ headers. The previous
    # codeload archive URL returned HTTP errors in GitHub Actions; using Git
    # transport avoids accepting an empty archive and keeps the version pinned.
    FetchContent_Declare(onnxruntime_headers
        GIT_REPOSITORY https://github.com/microsoft/onnxruntime.git
        GIT_TAG v${ORT_VERSION}
        GIT_SHALLOW TRUE)
    FetchContent_GetProperties(onnxruntime_headers)
    if(NOT onnxruntime_headers_POPULATED)
        FetchContent_Populate(onnxruntime_headers)
    endif()

    set(ORT_AAR_EXTRACT "${POCKET_DEPS}/ort-aar")
    file(MAKE_DIRECTORY "${ORT_AAR_EXTRACT}")
    if(NOT EXISTS "${ORT_AAR_EXTRACT}/jni/arm64-v8a/libonnxruntime.so")
        file(ARCHIVE_EXTRACT INPUT "${ORT_AAR}" DESTINATION "${ORT_AAR_EXTRACT}")
    endif()
    set(ORT_LIB "${ORT_AAR_EXTRACT}/jni/arm64-v8a/libonnxruntime.so")
    set(ORT_HEADERS "${onnxruntime_headers_SOURCE_DIR}/include")
    if(NOT EXISTS "${ORT_LIB}" OR NOT EXISTS "${ORT_HEADERS}/onnxruntime/core/session/onnxruntime_cxx_api.h")
        message(FATAL_ERROR "Verified ONNX Runtime Android library or pinned headers are missing")
    endif()

    # Consume only the pinned native source snapshot, not its separate Android app.
    FetchContent_Declare(pockettts_android_reference
        GIT_REPOSITORY https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine.git
        GIT_TAG v0.5.5 GIT_SHALLOW TRUE)
    FetchContent_GetProperties(pockettts_android_reference)
    if(NOT pockettts_android_reference_POPULATED)
        FetchContent_Populate(pockettts_android_reference)
    endif()

    set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
    set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
    set(SPM_PROTOBUF_PROVIDER "internal" CACHE STRING "" FORCE)
    set(SPM_ABSL_PROVIDER "internal" CACHE STRING "" FORCE)
    set(SPM_ENABLE_NFKC_COMPILE OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(sentencepiece
        GIT_REPOSITORY https://github.com/google/sentencepiece.git
        GIT_TAG v0.2.1 GIT_SHALLOW TRUE)
    FetchContent_Declare(dr_libs
        GIT_REPOSITORY https://github.com/mackron/dr_libs.git
        GIT_TAG 50bb723e6a459dbb781e26cefee4fd9ca6714d6a)
    FetchContent_MakeAvailable(sentencepiece dr_libs)
    if(TARGET sentencepiece-static)
        target_compile_options(sentencepiece-static PRIVATE -w)
    endif()
    foreach(spm_tool spm_decode spm_encode spm_export_vocab spm_normalize spm_train)
        if(TARGET ${spm_tool})
            target_link_libraries(${spm_tool} log)
        endif()
    endforeach()

    set(POCKET_VENDOR "${pockettts_android_reference_SOURCE_DIR}/vendor")
    set(POCKET_CPP "${POCKET_VENDOR}/PocketTTS.cpp/pocket_tts.cpp")
    set(SONIC_SOURCE "${POCKET_VENDOR}/sonic/sonic.c")
    if(NOT EXISTS "${POCKET_CPP}" OR NOT EXISTS "${SONIC_SOURCE}")
        message(FATAL_ERROR "Pinned Pocket TTS native sources are missing")
    endif()

    add_library(pockettts_jni SHARED pockettts_jni.cpp "${POCKET_CPP}" "${SONIC_SOURCE}")
    target_compile_features(pockettts_jni PRIVATE cxx_std_17)
    target_compile_definitions(pockettts_jni PRIVATE PTT_SHARED_LIB)
    target_compile_options(pockettts_jni PRIVATE -O3 -fvisibility=hidden)
    target_include_directories(pockettts_jni PRIVATE
        "${POCKET_VENDOR}/sonic" "${ORT_HEADERS}"
        "${ORT_HEADERS}/onnxruntime/core/session"
        "${sentencepiece_SOURCE_DIR}/src" "${dr_libs_SOURCE_DIR}")
    target_link_libraries(pockettts_jni PRIVATE "${ORT_LIB}" sentencepiece-static log android)
else()
    message(STATUS "Pocket TTS disabled for ABI ${ANDROID_ABI}; supported ABI: arm64-v8a")
endif()
