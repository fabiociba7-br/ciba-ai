cmake_minimum_required(VERSION 3.22.1)
project(garcia_chatterbox_runtime LANGUAGES C CXX)

include(FetchContent)

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

# Android Gradle may configure this same FetchContent source more than once
# (including duplicate ABI configure tasks). Serialize all mutations of the
# shared source tree and keep GGML setup idempotent across those invocations.
set(GARCIA_SOURCE_LOCK "${chatterbox_source_SOURCE_DIR}/.garcia-source-setup.lock")
file(LOCK "${GARCIA_SOURCE_LOCK}" GUARD PROCESS TIMEOUT 180 RESULT_VARIABLE GARCIA_LOCK_RESULT)
if(NOT GARCIA_LOCK_RESULT STREQUAL "0")
    message(FATAL_ERROR "Could not lock shared Chatterbox source tree: ${GARCIA_LOCK_RESULT}")
endif()

set(GARCIA_GGML_READY "${chatterbox_source_SOURCE_DIR}/.garcia-ggml-ready")
if(NOT EXISTS "${GARCIA_GGML_READY}")
    execute_process(
        COMMAND bash scripts/setup-ggml.sh
        WORKING_DIRECTORY ${chatterbox_source_SOURCE_DIR}
        RESULT_VARIABLE GGML_SETUP_RESULT
    )
    if(NOT GGML_SETUP_RESULT EQUAL 0)
        message(FATAL_ERROR "Could not prepare the pinned Chatterbox GGML source")
    endif()
    file(WRITE "${GARCIA_GGML_READY}" "ggml=58c38058\n")
endif()

set(GARCIA_MTL_PATCH "${CMAKE_CURRENT_SOURCE_DIR}/../../../patches/garcia-multilingual-engine.patch")
if(NOT EXISTS "${GARCIA_MTL_PATCH}")
    message(FATAL_ERROR "Missing Garcia multilingual patch: ${GARCIA_MTL_PATCH}")
endif()

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
    # A second configure may encounter a patch already applied by the first.
    # Accept that state only if the complete patch reverses cleanly.
    execute_process(
        COMMAND git apply --reverse --check "${GARCIA_MTL_PATCH}"
        WORKING_DIRECTORY ${chatterbox_source_SOURCE_DIR}
        RESULT_VARIABLE MTL_PATCH_REVERSE_CHECK
    )
    if(NOT MTL_PATCH_REVERSE_CHECK EQUAL 0)
        message(FATAL_ERROR "Chatterbox source is neither clean nor fully patched for Garcia MTL")
    endif()
endif()

add_subdirectory(${chatterbox_source_SOURCE_DIR} chatterbox-build)

add_library(garcia_chatterbox SHARED chatterbox_jni.cpp)
target_compile_features(garcia_chatterbox PRIVATE cxx_std_17)
target_compile_options(garcia_chatterbox PRIVATE -O3 -fvisibility=hidden)
target_link_libraries(garcia_chatterbox PRIVATE tts-cpp android log)
