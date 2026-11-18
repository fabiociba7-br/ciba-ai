# Garcia local image generation — engine evaluation

## Goal

Generate images on the Android device itself. Prompts, source images and generated images must not be sent to a hosted image-generation API or inference server. Model files are user-selected and are not bundled in the APK.

## Candidate comparison (18 Nov 2026)

| Project | Runtime / device support | Useful capabilities | Integration decision |
|---|---|---|---|
| [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) | Native C/C++; CPU and optional GGML backends including Vulkan, depending on build | SD-family checkpoints, image generation and image-processing APIs | **Primary engine.** MIT-licensed, small C API, fits the existing Kotlin/JNI Android app. |
| [Local Dream](https://github.com/xororz/local-dream) | Android; MNN CPU/GPU and Qualcomm QNN NPU paths | SD 1.5 / SDXL, txt2img, img2img, inpaint | Excellent technical reference for acceleration and UX. Its repository is CC BY-NC 4.0; do not copy or redistribute its app/source into Garcia without separate permission. QNN also requires Qualcomm's SDK/toolchain and compatible Snapdragon hardware. |
| [Local-Diffusion](https://github.com/rmatif/Local-Diffusion) | Flutter + stable-diffusion.cpp | Several diffusion families, offline Android generation | Useful reference for model catalog and performance testing; Flutter UI is not a direct fit for Garcia's native Compose app. |
| [MagicWX](https://github.com/Pangu-Immortal/MagicWX) | Kotlin/Compose, MNN native backend | Local SD 1.5 generation and image editing workflow | Useful Android architecture reference. Verify each module and model license before reusing code. |
| [AndroidCraft](https://github.com/Ishuin/AndroidCraft) | Native Android, stable-diffusion.cpp / optional ONNX | Local SD 1.5, model management | Useful reference for native JNI and model-download UX; validate licenses and current device compatibility before copying code. |

## Current implementation

- Native stable-diffusion.cpp is pinned to commit 532d2c15c430a785a712b2d94281f04e733008a4.
- The engine is built from source by CMake/NDK and called through JNI.
- Model weights are selected by the user; they are not embedded in the APK.
- Generation is performed locally after a model is loaded.
- The first backend is CPU-only. GPU/Vulkan and Qualcomm QNN/NPU are not yet enabled.
- The UI currently exposes text-to-image at 512×512 / 20 steps and saving to the Android gallery.

## Licensing

The engine's MIT license does not grant rights to model weights. Each model/checkpoint, VAE, LoRA, embedding and safety component must be reviewed separately. Model downloads must show the source and license to the user. Do not bundle weights in the APK unless redistribution is explicitly permitted.

Local Dream is not being vendored: its repository is marked CC BY-NC 4.0, which is incompatible with assuming unrestricted commercial redistribution. Its implementation is used only as a public technical reference.

## Validation gates before release

1. Android Kotlin compilation and native NDK build pass for supported ABIs.
2. Test a known-compatible SD 1.5 checkpoint on a physical Android device.
3. Verify actual output pixels, dimensions, gallery persistence, memory use and generation latency.
4. Handle insufficient storage/RAM and unsupported model formats without crashing.
5. Add progress and cancellation, then test activity/background lifecycle.
6. Benchmark CPU against Vulkan on representative Adreno and Mali devices before enabling GPU by default.
7. Add Qualcomm QNN only as a separately gated backend after SDK/license review and physical Snapdragon device tests.
8. Do not describe SDXL, img2img, inpainting, Vulkan or NPU as supported until each has end-to-end test evidence.

## Important limitation

A successful Gradle compile does not prove image generation works. A physical-device test with a known compatible model is required before calling this feature complete.