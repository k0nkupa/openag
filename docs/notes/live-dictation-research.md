# Live dictation research — 4 November 2026

Research only. No implementation, installation, provider request, microphone test
or preview change was made. Provider documentation establishes an available API
contract, not this installation's account access, latency or recognition quality.

## Current OpenAg behavior

`apps/daemon/src/transcription.ts` accepts one completed recording and sends one
multipart file request. It reads a complete JSON transcript. The current composer
therefore cannot display recognized words during capture without a new transport
and incremental transcript handling. This is independent of the chat bot model.

## Supported paths

| Path | What the official contract supports | Implication |
| --- | --- | --- |
| OpenAI Realtime transcription | The recommended `gpt-live-transcribe` receives appended audio and emits transcript deltas while audio arrives; commit produces the final transcript. The documented WebSocket input example uses mono PCM16 at 24 kHz. | Direct fit for text appearing while the user speaks. |
| OpenAI file transcription | `stream=true` streams text from a completed recording. The guide explicitly directs ongoing microphone input to Realtime. | Enabling this flag on our existing request would still wait for Stop. |
| Ollama transcription | `/v1/audio/transcriptions` takes a WAV file and can stream transcript events. Long files are split at pauses into pieces. The current compatibility page does not document Realtime audio input. | Output streaming alone does not establish live microphone support. Keep LFM3-Omni as record-then-transcribe unless a separate bounded spike proves a live path. |

Sources: [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text),
[Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).

Ollama lists LFM3-Omni as audio-capable, but audio understanding is not proof of
incremental recognition during input. Its model page does not promise that
behavior. [LFM3-Omni model page](https://ollama.com/library/lfm3-omni).

Claude's current model overview lists text/image input and text output. It does
not establish an Anthropic speech-to-text API; a Claude chat bot can still use a
separate transcription provider. [Claude model overview](https://platform.claude.com/docs/en/models/overview).

## Recommendation

Start with OpenAI live dictation, retaining Ollama's completed-recording path.
Keep the permanent API key on the daemon. Add an authenticated, bounded live
audio session and partial/final transcript events. Preserve typed drafts and
attachments; Stop finalizes text, Cancel discards this dictation's text, and Send
remains explicit. Partial text can change and needs clear ownership so final
events cannot duplicate it or overwrite user edits.

For a local-only live option, evaluate a streaming ASR model and runtime as a
separate task. Sending short completed WAV segments to the existing Ollama API
could provide phrase-by-phrase updates, but adds segmentation gaps, context and
duplicate-word handling. That is an engineering alternative, not a documented
native LFM3-Omni live feature. No timing estimate is established by this research.
