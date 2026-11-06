# Friday local speech

Friday uses a single opt-in microphone session across workspace navigation. A pause ends a turn; the native conversation receives the transcript, owns execution, and returns the answer. Capture can remain active while Friday speaks so a recognized interruption can stop playback; recognizable playback echo is discarded. Navigation minimises history without disabling the microphone. Changing employee identity, explicitly pausing, or leaving the app closes capture. Hiding the page pauses capture/playback while retaining the enabled preference.

## Installation

The current local engine targets Apple Silicon macOS with Python 3.12. Install models outside the checkout:

```sh
python3.12 scripts/setup-friday-voice.py /absolute/private/voice-directory
```

Set `AGENTOS_VOICE_HOME` to that directory in the server's private environment and restart. The installer creates an isolated Python environment, pins the speech packages and verifies model SHA-256 hashes from `scripts/friday-voice-models.json`. It registers no login service. Python, macOS audio permission and browser microphone permission are prerequisites; the script does not change them.

When the visible Friday interface connects, it requests local model preparation using synthetic silence and a discarded synthetic reply. No microphone is opened until the user enables it. The backend starts independent private JSON-lines Python workers for transcription and speech on demand and releases each after five idle minutes. Each worker is bounded to two pending operations, 60-second processing deadlines and 65-second decoded audio. The browser records at most 45 seconds per turn. Models are loaded from disk with offline mode enabled; no model inference service is billed. Voice data is not retained by the worker. Native text conversation history remains retained normally.

Whisper base.en currently transcribes English. Kokoro uses its `af_heart` voice. Other languages and non-Apple hardware need separate implementations. The VAD uses local sound level and silence detection, so room noise and microphone gain affect turn boundaries and interruption needs physical-device qualification. If local voice is unavailable, the UI labels browser speech as a fallback that may use the browser vendor's speech service. It does not promise that fallback is offline.

Live previews use short snapshots of at most the latest 12 seconds while speech is detected, with one preview request in flight and roughly half a second between snapshots. Previews can revise words and never enter the agent conversation. The full turn is transcribed after about 750 ms of silence, then sent exactly once. Capture runs at 16 kHz. The preview sits beneath Friday, above Prefer to type; the upper-right mic is red/slashed when muted and blue when enabled, and the orb turns blue while listening.

## Provenance

- [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), MIT; converted [base.en weights](https://huggingface.co/mlx-community/whisper-base.en-mlx), with a pinned download revision.
- [Kokoro ONNX runtime](https://github.com/thewh1teagle/kokoro-onnx), MIT; [Kokoro model](https://github.com/hexgrad/kokoro), Apache-2.0. Model binaries and voice data are downloaded into the private runtime, not distributed in this repository.
- [SoundFile](https://github.com/bastibe/python-soundfile), BSD-3-Clause.

## Verification and troubleshooting

Settings → Voice reports whether the required local files exist; this is installation status, not a microphone test. The company-scoped, operator-only `/api/companies/:companyId/friday/voice` endpoint supports `prepare`, `speak` and `transcribe`. Its POST response sends `Cache-Control: no-store` and returns JSON containing base64 WAV audio or a transcript. Dependency errors become bounded unavailable responses without echoing audio or transcripts into logs. Friday shows Preparing reply audio while playback is pending; Speaking starts only after the audio element's play request succeeds or the browser utterance emits its start event. Cancelled starts cannot restore that label.

The synthetic localhost HTTP round trip recovered the exact sample sentence. It does not prove browser microphone permission, autoplay behavior, room-noise handling, voice quality or mobile acceptance. Browser speech requires a secure context: localhost works for local development; plain HTTP on another device's LAN address generally does not. Revisit HTTPS before testing a phone against this local backend.
