# Garcia — on-device voice cloning

Status: Android capture, profile management, model download, and native runtime integration are implemented in the feature branch. CI compilation and physical-device inference are still validation gates; do not describe the feature as production-verified until both pass.

## User experience

- Ordinary text chat remains text-only.
- Speech output is used only when the user explicitly starts voice conversation.
- The user can import an audio file or record a sample directly in Garcia.
- The screen provides a short reading script, playback of the reference sample, profile naming, consent confirmation, and generated-voice preview.
- Profiles can be selected, renamed, and deleted. A newly saved profile does not overwrite older profiles.
- The active profile is used by Garcia's voice-only speech output. If a profile is active but its engine is not ready, Garcia does not silently substitute a different voice.
- Reference audio, normalized WAV, model files, and conditioning cache remain in app-private storage. No recording or synthesis request is uploaded to a cloud API.
- Profile creation requires the user's own voice or explicit authorization from the recorded speaker.

## Runtime and native build

### Selected engine: chatterbox.cpp

Repository: https://github.com/gianni-cor/chatterbox.cpp

Pinned source commit: `ddca05fb69c2910b0d7b5eae420d360ed98c067b`.

The Android library module `:chatterbox-runtime` builds this C++ runtime in a separate CMake project. This isolation is intentional: Garcia already builds Whisper.cpp with a different GGML tree, and the Chatterbox fork carries its own pinned GGML revision and patches. Do not merge the two GGML builds into one CMake target graph without a deliberate compatibility review.

A Garcia patch extends the persistent public Engine API to support the multilingual T3 path: MTL tokenizer, Portuguese language selection, CFG/min-p/exaggeration parameters, conditional/unconditional logits, and multilingual sampling. It also adds writing and reloading the five cached voice-conditioning tensors. The engine remains resident between utterances; Garcia does not launch the CLI or reload model weights for each sentence.

The JNI API exposes model loading, reference conditioning, PCM synthesis, cancellation, and release. Kotlin serializes engine use and plays the returned 24 kHz mono PCM through AudioTrack.

### Model files

The app downloads the two Q4_K multilingual GGUF files only after the user taps the download control:

- `chatterbox-t3-q4_k.gguf`
- `chatterbox-s3gen-q4_k.gguf`

Source: `cstr/chatterbox-GGUF`, pinned revision `c45504bb8d55473a2213db17ec472ed11b69056a`. The listed file sizes are approximately 382 MB and 255 MB. SHA-256 checks are performed against the pinned file hashes before a model is accepted. The app checks available storage, validates GGUF headers, and stores models under app-private files. Models are not bundled into the APK.

CPU is the current build baseline. OpenCL/Adreno acceleration is not enabled in this Android module yet; do not claim GPU acceleration or real-time performance.

## Reference audio and profile lifecycle

- Prefer 10–15 seconds of clear, single-speaker speech; the engine requires more than five seconds.
- Imported audio and microphone recordings are validated locally.
- Audio is normalized to mono 24 kHz WAV. PCM WAV, M4A/AAC and formats supported by Android MediaExtractor can be decoded locally.
- The engine extracts speaker embedding, speech tokens, CAMPPlus embedding, prompt tokens, and reference mel features.
- All five conditioning tensors are cached under the named profile and reused when that profile is selected again.
- Profile sample, normalized WAV, and conditioning cache live under the app's private `filesDir/voice-profiles/<profile-id>/` directory.
- Avoid music, overlapping speakers, strong reverberation, clipping, and long silence.

## Validation gates

- Android unit tests and Kotlin compilation.
- Separate `:chatterbox-runtime:externalNativeBuildDebug` CMake/NDK build, with no APK task.
- Confirm the pinned model files load with the pinned C++ engine.
- Physical-device test: import and record samples, create and reload multiple profiles, synthesize Portuguese, play audio, cancel synthesis, and verify that normal text chat remains silent.
- Do not claim voice similarity, acceptable latency, or production readiness until the physical-device test passes.
- Routine CI must not generate APKs. Create an APK only when explicitly requested or required for device validation.
