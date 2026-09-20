# ADR 0011: Workspace-owned voice sessions with explicit speech adapters

- Status: accepted for P10 automated implementation
- Date: 2026-09-20
- Prerequisites: workspace settings, OpenRouter task runtime, and awake-only scheduling
- Inputs: P10 and provisional Q10/Q12 defaults

## Decision

Voice is a workspace-owned adapter around the existing P05 task runtime. Finalized transcripts create ordinary OpenRouter tasks; partial transcripts never execute. Every session, utterance, transcript, and resulting task carries stable identity. A bounded durable registry under `.voidra/voice.json` records session state and, only when enabled, text turns. Captured microphone bytes and synthesized audio are transient and are never written to the workspace registry.

The renderer captures a user-initiated microphone recording through `MediaRecorder`. Electron grants `media` permission only to the trusted `app://voidra/` renderer. The service sends the completed recording to ElevenLabs `POST /v1/speech-to-text` using `scribe_v2`, then submits the returned final text once. Text-to-speech uses the configured effective workspace voice ID with ElevenLabs' streaming speech endpoint and `eleven_flash_v2_5`. The ElevenLabs key is encrypted with Electron `safeStorage`, is never returned to the renderer, and is injected only into the local service process.

Global voice settings remain defaults. A workspace may independently override voice enablement and voice ID. No voice ID is silently substituted when the selected identity fails.

## Interruption and lifecycle

Voice states are `idle`, `listening`, `transcribing`, `thinking`, `speaking`, `interrupted`, `error`, and `muted`. An interruption always stops renderer playback, aborts in-flight synthesis, increments the session generation, and discards stale audio. “Also cancel reasoning” separately aborts the owning P05 task. Completed effects are not undone by speech interruption.

Changing workspace unmounts the prior voice surface, stops capture/playback, and interrupts its active session without cancelling reasoning by default. Startup converts any formerly active persisted state to `interrupted`; synthesized audio is not recoverable or replayed after restart.

Final transcript IDs are retained in a bounded deduplication set even when text retention is disabled. Disabling transcript retention clears saved turn text. Raw recordings are sent to ElevenLabs but not stored locally; provider-side retention remains governed by the user's ElevenLabs account and request terms.

## Wake-word boundary

The enable/mute/activation state machine and a deterministic E2E activation event are implemented. Production deliberately reports that no local wake-word engine is installed. Engine selection, packaging, target-language accuracy, false-positive thresholds, and idle CPU acceptance remain blocked on Q10 and a physical-device spike. The fixture proves routing and workspace ownership, not recognition quality.

## Consequences

- Keyboard-entered transcripts provide a captioned, audio-independent fallback for permission, device, and provider failures.
- Speech synthesis failure leaves the completed OpenRouter text result and retained turn visible.
- The current upload transcription begins after recording stops; it is not represented as real-time streaming transcription.
- Microphone, speaker/headset, real ElevenLabs voice, language/dialect, latency, network loss, wake accuracy, and packaged macOS permission prompts require physical/live acceptance.

## References

- [ElevenLabs create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
- [ElevenLabs stream speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron session permissions](https://www.electronjs.org/docs/latest/api/session)
