# P10 — Voice, interruption, and wake word

[Plan index](main.md) · Previous: [P09](phase-09-macos-control.md) · Next: [P11](phase-11-remote.md)

## Outcome and prerequisites

Users speak through push-to-talk or a conversational session, hear their selected ElevenLabs voice, interrupt speech, and optionally activate the assistant with a wake word. Text and voice share task context without crossing workspaces.

Prerequisites: P05 runtime, P01 workspace/credential settings, P07 jobs. P09 is needed only for voice-triggered Mac actions. Q10 must settle spoken/interface languages and any Iraqi Arabic expectation before promising support. User supplies voice ID and credentials during setup, not in committed files.

## Speech architecture

- Treat transcription and speech synthesis as adapters around the existing task runtime. OpenRouter remains the automatic reasoning provider; manual prompts still compile without inference calls.
- Candidate pipeline: microphone → transcription stream → finalized user turn → Voidra runtime → output text stream → ElevenLabs speech. Validate language/model compatibility with actual service documentation and test samples during implementation.
- Keep partial/final transcript IDs, timestamps, utterance IDs, task IDs, and workspace IDs. Partial transcripts must not execute repeated commands before the user's turn is finalized.
- Conversational state includes idle/listening/transcribing/thinking/speaking/interrupted/error/muted. Visual indicators and keyboard controls reflect actual state.
- Barge-in stops queued/stale audio and begins a new user turn. Distinguish "stop speaking" from "cancel the task"; cancellation flows through P05/P09 and cannot undo an already completed effect.
- A workspace switch stops prior audio capture/output context and starts a fresh explicit context; avoid finishing a Personal response aloud in Work.
- Prefer local wake-word detection with explicit opt-in and mute. Select an engine based on actual target-language support, false-positive rate, latency, licensing, and packaged CPU use.
- Save transcript/audio only under explicit retention settings. Never put voice keys into renderer logs or shared knowledge.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P10-01: Configure voice and microphone | 3 | P01, Q10 | User selects/validates ElevenLabs voice, chooses input, and sees denied/unavailable-device states |
| P10-02: Push-to-talk task input/output | 5 | P05, P10-01 | Final transcript creates one task turn; chosen voice speaks output; text history matches the session |
| P10-03: Interruptible conversation | 8 | P10-02 | Barge-in stops stale audio, preserves turn order, and never duplicates a tool action |
| P10-04: Wake-word activation | 5 | P10-01/02, engine spike | Optional local detector starts listening, obeys mute, and meets recorded target-language/hardware criteria |
| P10-05: Workspace/retention/accessibility behavior | 5 | P10-02–04 | Workspace change isolates voice context; caption/text controls work without audio; retention settings are honored |

## Unit and integration tests

- Audio/session state machine covers silence, finalization, partial updates, reconnect, malformed provider events, long utterances, and cancellation.
- Queue tests discard stale audio by utterance/workspace ID and preserve expected order under slow synthesis.
- A transcript repeated after reconnection creates no duplicate user turn/action.
- Voice resolution follows global/workspace overrides; invalid voice IDs fail usefully without switching silently to another identity.
- Wake-word adapter tests mute/enable/activation events; these validate wiring, not recognition accuracy.
- Retention logic removes eligible recordings/transcripts from app-managed stores without claiming deletion from external providers.

## Playwright E2E

1. Feed deterministic audio/transcript fixtures through push-to-talk; inspect one user turn and expected output/caption.
2. Simulate streamed speech, interrupt it, and verify queued old audio stops while the new utterance is retained.
3. Switch Work/Personal mid-speech; no stale context/audio appears in the new session.
4. Deny microphone, remove input device, expire speech credentials, and disconnect the provider; text interaction remains usable.
5. Simulate wake-word events with mute on/off; listening indicator and task creation match configured behavior.

## Physical audio acceptance

Test the actual microphone/speaker/headset, echo behavior, latency, network loss, barge-in, and user-selected languages with the real ElevenLabs voice. If Iraqi Arabic is selected, collect representative consented samples and evaluate recognition/pronunciation; do not infer dialect quality from generic Arabic availability.

Record median and tail latency, false wake activations over a defined ambient sample, missed activations, and CPU while idle/listening. Set pass thresholds after Q10 and the engine spike. Fake audio tests are not evidence of these qualities.

## Exit criteria

All interaction modes exist, workspace/cancellation tests pass, and physical-language/audio results meet agreed targets. No hidden speech call is required for manual text handoff.

References: [ElevenLabs streaming synthesis](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts), [streaming transcription](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming).
