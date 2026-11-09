# Composer dictation research

Research date: 4 November 2026. Primary documentation and source inspection only. No microphone recording, provider request, deployment or user acceptance was performed. Recommendations below describe proposed OpenAg behavior.

## Findings

Dictation should produce editable draft text before normal message submission. The transcription target can be independent of the chat target. Existing credentials can be reused where the selected provider actually supports transcription; chat compatibility alone does not establish that capability.

## Named projects and comparable implementations

The names supplied were ambiguous. The plausible OpenBoard match is `camwilso/openboard`, a macOS controller for coding harnesses; other projects also use OpenBoard. The plausible OpenMuse match is `OpenMuseAgent/OpenMuse`. These identifications are assumptions, not user-confirmed identities.

| Project | What the inspected evidence establishes | Lesson for OpenAg |
| --- | --- | --- |
| OpenBoard | At source revision `db17b44ebaa8815809501e4c356e768e2d6b877b`, voice actions synthesize Space, a configured Ctrl-Y chord, or `/voice` into another application. They invoke the host harness's voice behavior rather than implement a transcription backend. Space has different behavior when input already contains text. | Keep microphone actions explicit and preserve an existing draft. This is a control integration reference, not evidence that subscription credentials expose a reusable transcription API. |
| OpenMuse | At source revision `76b71309f49e5055d216cc57e41a68ae660e3190`, its README still lists voice through OpenAI-compatible `/audio/transcriptions` as an unchecked roadmap item. The repository says development moved to nanoMuse. | Its planned review-before-send interaction is relevant; the inspected OpenMuse snapshot does not prove a shipped dictation path. The successor was not audited. |
| Open WebUI | Official STT documentation separates audio configuration from chat: local Whisper, OpenAI, authenticated compatible servers, Mistral, Deepgram and Azure, with browser recognition as a user setting. It documents server-side MIME and extension restrictions. | Separate transcription capability/configuration from chat, and validate uploaded audio at the daemon boundary. |
| LibreChat | Official speech settings separate browser/external/OpenAI/Azure STT. Local compatible servers have their own URL, model and credential block. Optional silence detection and auto-send are distinct controls. | Start with explicit stop, transcription, draft insertion and manual send. Silence detection and auto-send add independent behavior and are unnecessary for the first slice. |

Sources: [OpenBoard voice actions, pinned source](https://github.com/camwilso/openboard/blob/db17b44ebaa8815809501e4c356e768e2d6b877b/mac/Sources/OpenBoard/Actions.swift), [OpenBoard voice binding, pinned source](https://github.com/camwilso/openboard/blob/db17b44ebaa8815809501e4c356e768e2d6b877b/mac/Sources/OpenBoard/SettingsPanes.swift), [OpenMuse README, pinned source](https://github.com/OpenMuseAgent/OpenMuse/blob/76b71309f49e5055d216cc57e41a68ae660e3190/README.md), [Open WebUI STT](https://docs.openwebui.com/features/chat-conversations/audio/speech-to-text/stt-config/), [LibreChat speech settings](https://www.librechat.ai/docs/configuration/stt_tts).

## Provider capability findings

- **OpenAI:** current official file-transcription documentation shows authenticated multipart `POST /v1/audio/transcriptions` using `gpt-transcribe`. It distinguishes completed-file transcription from live transcription. The guide currently marks older Whisper/GPT-4o transcription families deprecated, with shutdown on 26 February 2027. Do not copy older OSS default model IDs without checking availability. This establishes the documented contract, not account entitlement or a successful request. [Official file-transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).
- **Ollama:** current official compatibility documentation explicitly includes `/v1/audio/transcriptions` with an audio-input model, WAV input and JSON/text outputs; it also documents streaming transcript events. Thus local Ollama transcription is a supported documented possibility. The installed server version, available model, practical recording conversion and live acceptance remain unverified. Do not infer support from an ordinary text model or the chat endpoint. [Official compatibility contract](https://docs.ollama.com/api/openai-compatibility#v1audiotranscriptions).
- **Anthropic:** the inspected Messages reference describes text/image conversation input and does not establish an audio transcription endpoint. Treat native Anthropic transcription as unavailable in the proposed integration until an explicit official contract is verified. A Claude chat target can still receive text produced by a different transcriber. This is a scoped documentation finding, not a claim about every present or future Anthropic product. [Messages reference](https://platform.claude.com/docs/en/api/messages).

## Proposed first slice and evidence needed

Use a selected installation transcription target, with an explicit provider, transcription model and supported audio contract. Keep credentials daemon-side. Record only after a user action; stop or cancel must release the microphone. Put successful transcript text into the originating draft and require ordinary Send. Avoid automatic provider fallback because it can send audio to an unexpected destination.

Browser capture needs permission and a secure context; phone access through a plain LAN HTTP address must not be assumed to work. Recording MIME support varies, so negotiate the format and verify it against the provider contract; Ollama's documented WAV input makes this especially relevant. [Microphone constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [Recording format support](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

Before claiming delivery, verify one real recording on each supported browser/device route, transcription with the chosen provider/model, insertion into an existing draft, cancel, navigation during capture/request, permission denial, oversized/invalid audio and failed/uncertain provider responses. Check account availability separately from credential presence. No audio or transcript content should enter shared logs or product knowledge.

This research adds no implemented feature, help promise or bot tool. Delivered feature documentation and bot knowledge must be updated with implementation, once behavior is verified. No unit/Jest suites were run.
