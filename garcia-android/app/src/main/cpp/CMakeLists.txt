cmake_minimum_required(VERSION 3.22.1)
project(garcia_whisper LANGUAGES C CXX)

include(FetchContent)

# Pin the exact upstream commit behind whisper.cpp v1.9.5.
# Source is fetched at build time; no model weights or binaries are committed.
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

FetchContent_Declare(
    whisper_cpp
    GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
    GIT_TAG d1be6fde11ac6e0407606b4e42fe72d34add8037
    GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(whisper_cpp)

add_library(garcia_whisper SHARED whisper_jni.cpp)
target_compile_features(garcia_whisper PRIVATE cxx_std_17)
target_compile_options(garcia_whisper PRIVATE -O3 -fvisibility=hidden)
target_link_libraries(garcia_whisper PRIVATE whisper android log)
