cmake_minimum_required(VERSION 3.22.1)
project(garcia_chatterbox_runtime LANGUAGES C CXX)

include(FetchContent)

# Isolated CMake project: chatterbox.cpp carries a patched GGML revision
# and must not share targets with the app's Whisper GGML dependency.
set(GGML_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)
set(TTS_CPP_BUILD_LIBRARY ON CACHE BOOL "" FORCE)
set(TTS_CPP_BUILD_EXECUTABLES OFF CACHE BOOL "" FORCE)
set(TTS_CPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TTS_CPP_INSTALL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    chatterbox_source
    GIT_REPOSITORY https://github.com/gianni-cor/chatterbox.cpp.git
    GIT_TAG ddca05fb69c2910b0d7b5eae420d360ed98c067b
    GIT_SHALLOW FALSE
)
FetchContent_GetProperties(chatterbox_source)
if(NOT chatterbox_source_POPULATED)
    FetchContent_Populate(chatterbox_source)
endif()

# Upstream keeps GGML as a generated, untracked directory and applies its
# backend patches through this pinned setup script.
execute_process(
    COMMAND bash scripts/setup-ggml.sh
    WORKING_DIRECTORY ${chatterbox_source_SOURCE_DIR}
    RESULT_VARIABLE GGML_SETUP_RESULT
)
if(NOT GGML_SETUP_RESULT EQUAL 0)
    message(FATAL_ERROR "Could not prepare the pinned Chatterbox GGML source")
endif()

set(GARCIA_MTL_PATCH "${CMAKE_CURRENT_SOURCE_DIR}/patches/garcia-multilingual-engine.patch")
execute_process(
    COMMAND git apply --check "${GARCIA_MTL_PATCH}"
    WORKING_DIRECTORY ${chatterbox_source_SOURCE_DIR}
    RESULT_VARIABLE MTL_PATCH_CHECK
)
if(MTL_PATCH_CHECK EQUAL 0)
    execute_process(
        COMMAND git apply "${GARCIA_MTL_PATCH}"
        WORKING_DIRECTORY ${chatterbox_source_SOURCE_DIR}
        RESULT_VARIABLE MTL_PATCH_RESULT
    )
    if(NOT MTL_PATCH_RESULT EQUAL 0)
        message(FATAL_ERROR "Could not apply Garcia multilingual Engine patch")
    endif()
else()
    file(READ "${chatterbox_source_SOURCE_DIR}/src/chatterbox_engine.cpp" ENGINE_SOURCE)
    if(NOT ENGINE_SOURCE MATCHES "multilingual T3 prompt eval failed")
        message(FATAL_ERROR "Chatterbox source is neither clean nor patched for Garcia MTL")
    endif()
endif()

add_subdirectory(${chatterbox_source_SOURCE_DIR} chatterbox-build)

add_library(garcia_chatterbox SHARED chatterbox_jni.cpp)
target_compile_features(garcia_chatterbox PRIVATE cxx_std_17)
target_compile_options(garcia_chatterbox PRIVATE -O3 -fvisibility=hidden)
target_link_libraries(garcia_chatterbox PRIVATE tts-cpp android log)
