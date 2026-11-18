# Garcia — on-device voice cloning

Status: implementation design / native-engine integration in progress.

## Product behavior

- Ordinary text chat remains text-only.
- Automatic speech is active only inside an explicitly started voice conversation.
- A user can import a reference recording, preview the resulting voice, name it, and save it as a local voice profile.
- The selected profile is used for every spoken Garcia response until the user selects another profile.
- Importing a new recording creates another profile; it does not overwrite an existing profile.
- Profiles and reference audio stay in the app's private storage. No voice sample or synthesis request is sent to a cloud API.
- A profile can only be created from the user's own voice or a recording whose speaker has explicitly authorized cloning.
- Users can preview, select, rename, and delete profiles. Deleting a profile also deletes its local reference and cached conditioning tensors.

## Engine research and selection

### Preferred runtime: chatterbox.cpp

Repository: https://github.com/gianni-cor/chatterbox.cpp

The C++/ggml port provides the full reference-audio conditioning pipeline: VoiceEncoder speaker embedding, S3Tokenizer speech tokens, CAMPPlus embedding, and reference mel features. Its CLI supports the multilingual Chatterbox model, Portuguese (pt), reference-audio conditioning, and saving/reusing the five conditioning tensors through its save-voice / ref-dir options. The README documents Android/Termux OpenCL work and Adreno testing.

The repository is MIT licensed. The upstream Chatterbox model repository is also MIT licensed but its README now states that the original project is retired research and no longer maintained. Treat the C++ port as a community implementation, pin an exact commit, and validate the runtime before release.

### Android ExecuTorch port: reference only

Repository: https://github.com/acul3/chatterbox-tts-android

This Android project demonstrates on-device multilingual Chatterbox inference with ExecuTorch, but its current app code loads fixed, precomputed default voice-conditioning tensors. It does not currently expose the complete reference-audio-to-five-conditioning-tensors flow in its Android UI. Do not treat it as a finished voice-cloning implementation.

## Important integration gap

At the selected chatterbox.cpp revision, the public tts_cpp::chatterbox::Engine API rejects multilingual GGUFs and only wires the Turbo T3 path. The CLI does support multilingual T3, including Portuguese and reference-audio conditioning. Garcia must not use the public Engine API for Portuguese until its multilingual inference path is added and tested.

The native integration therefore needs a Garcia-owned, persistent multilingual engine API (or an equivalent persistent native session) rather than launching the CLI afresh for every sentence. This keeps the model resident, avoids repeatedly loading approximately 1 GB of weights, and lets a selected voice profile be reused efficiently.

## Implementation sequence

1. Extend the pinned C++ runtime's persistent engine to support the multilingual T3 path already present in its CLI: MTL tokenizer, language selection, CFG/min-p/exaggeration sampling, reference conditioning, and S3Gen synthesis.
2. Add a stable native API for loading model files, creating a voice profile from a reference WAV, loading a cached profile, synthesizing PCM, cancelling synthesis, and releasing native memory.
3. Add an Android model manager for the two quantized multilingual GGUF files. Download only after explicit user action, verify file size/hash, support resume/retry, and show storage requirements. Do not bundle multi-hundred-megabyte weights in the APK.
4. Add a private voice-profile store. A profile contains metadata plus cached conditioning tensors; the original reference audio is retained only as long as needed for profile recreation or user-requested retention.
5. Add a Compose voice-profile screen: import audio, validate it, name profile, create/cache profile, preview, set active, rename, delete.
6. Route the existing voice-only TTS path to the active Chatterbox profile. Keep Android TextToSpeech as a fallback when no Chatterbox profile is active or model files are unavailable.
7. Keep generation serialized per native engine instance, expose progress/cancel/error states, release models on memory pressure, and never block the UI thread.
8. Add unit tests for profile metadata, file lifecycle, consent confirmation state, and speech text normalization; add Android native compile checks and a physical-device voice-cloning test.

## Reference audio handling

- Prefer 10–15 seconds of clear, single-speaker speech; reject recordings shorter than the engine's documented minimum.
- Convert/import to a normalized mono WAV locally. No network upload.
- Avoid music, overlapping speakers, strong reverberation, clipping, and long silence.
- Cache the five voice-conditioning tensors once per profile so later synthesis does not need the reference recording again.
- Keep the audio file and profile cache in app-private storage; do not expose them through public media folders by default.

## Performance and validation gates

- The multilingual Q4_0 model pair documented by chatterbox.cpp is approximately 344 MB (T3) + 685 MB (S3Gen), before temporary download files and runtime memory. The app must check available storage and RAM before downloading/loading.
- CPU inference is the baseline. OpenCL/Adreno acceleration is optional and must be runtime-detected; never assume a device supports the patched OpenCL backend.
- No claim of usable speed or voice similarity until tested on a physical Android device with the selected models and a consented reference recording.
- Do not generate an APK in routine CI. Build/test only; create an APK only when explicitly requested or required for device validation.