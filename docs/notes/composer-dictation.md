# Composer dictation

Source behavior, 4 November 2026. Deployment and physical-device acceptance are separate.

## Use and setup

In Settings → Models → Dictation, an owner or Full device chooses OpenAI or local Ollama and a transcription model, then saves. Dictation defaults to Off. The daemon reuses its existing environment credential through `providerCredential('openai')`; no key is accepted by the browser or settings API. New setups choose a model from discovered compatible file-transcription choices; no model ID is selected automatically. Existing saved choices are preserved. The older GPT-4o transcription choices remain explicit alternatives; official docs currently list their shutdown on 26 February 2027. Credential presence does not establish account/model access.

Local Ollama choices come from installed models reporting audio capability during
catalogue refresh. Install an audio-capable model on the daemon host, use Refresh
models, then select it. LFM3-Omni was the original verified example; it is not an
application allowlist. Dictation status reads cached metadata and performs no
provider request or inference. Browser recordings are decoded at 16 kHz, downmixed
to mono and encoded as PCM16 WAV before upload. OpenAI credentials are never sent
to Ollama. Neither a text model nor an unavailable local model triggers fallback.

Click Dictate message in a conversation, permit microphone access, speak, then Stop. The transcript appends once to the current draft, preserving typed text and attachments. Edit it and use ordinary Send. Recording/transcription blocks Send. Cancel and leaving the conversation release capture and discard late results. A microphone permission request that resolves after cancellation immediately releases its tracks.

While an active capture has an empty draft, the composer replaces its ordinary Message prompt with Starting microphone, Recording or Transcribing in the same prompt location. That visual label has a quiet opacity pulse and is not interactive; the native textarea remains the focusable editor. There is one status announcement for assistive technology. It is screen-reader-only while the prompt replacement is visible, then becomes the compact row above a nonempty draft. Typing removes the overlay immediately; clearing text while capture continues restores it. Reduced-motion preference keeps the label static and fully legible.

Dictation is independent of the agent's chat model, room routing, mentions and subscription adapter. A Limited device that can compose can dictate; only owner/Full can configure the installation target. This is a user-invoked composer operation, not an agent tool or unattended capability. It starts no turn until Send.

## Contract and limits

- Authenticated `GET /dictation` reports configured target, availability and capture limits without inference.
- `PUT /settings/dictation` is owner/Full-only and accepts the strict enabled/provider/model setting and a current catalogue selection token for a changed target. Existing settings audit applies; it contains no audio, transcript or credentials.
- `POST /rooms/:id/dictation` accepts raw WebM, MP4 or WAV audio, bounded to 8 MiB. The target header must match the current setting before submission. Local Ollama accepts WAV only. Body handling rechecks device authority before provider dispatch and before returning the result. Private/missing rooms are refused.
- Audio container signatures and MIME are checked before dispatch. Provider decoding remains authoritative for the actual encoded audio. Browser capture stops after 120 seconds; the HTTP byte cap is independent and does not establish a server-side decoded duration limit.
- One active request per initiating device/owner and two total. OpenAI uses a fixed HTTPS endpoint; local Ollama uses only a validated loopback HTTP origin from OPENAG_OLLAMA_URL (default 127.0.0.1:11434). Both use no redirects or retries, a 60-second provider deadline, 64 KiB response cap and 16,000-character transcript cap. HTTP errors, nested errors and empty/invalid results fail. Raw provider errors are never returned or logged.
- Audio is held transiently in browser/daemon memory and sent to the selected provider. OpenAg creates no audio file, attachment, ledger transcript or history entry. Transcripts pass the existing redactor before return; ordinary submission still follows ingress redaction. Provider retention/billing is separate.
- Cancel aborts the browser request and ignores its result. Provider processing or billing may already have occurred. Unknown outcomes are reported without retry or fallback.
- Microphone access needs a supported browser and HTTPS or localhost. WebM/MP4 format support is negotiated. Plain LAN HTTP and physical Safari are not established by a desktop Chrome check.
- WebRTC currently carries bounded text frames. Dictation reports that a LAN/Tailscale connection is required before capture; binary audio transport is not added here.

## Integration pre-build review

Kind: first-party composer input feature, new transcription transport. Offered agent tools/classes: none. MCP tool identity, classification, approval/provider prompt mapping, MCP session reuse, elicitation and task-only tool catalogues are not on this path and are unchanged. No OAuth or provider prompt is introduced. The explicit microphone/Stop action submits audio under the selected installation target; bot permissions gain no new authority.

Path: browser recording → authenticated desk API → room/size/config/authority guards → fixed provider request → bounded strict result → originating draft. Existing credential lookup/redactor owns keys; the settings schema owns accepted model identities. A second dictation in the same composer exercises resource reuse, rather than ACP session reuse. The independent live target is a synthetic speech clip with a known sentence, no private user content and no provider write target. Result interpretation checks reject nested errors; unknown results are never replayed. Controlled transport and browser harness evidence must stay separate from live transcription and owner-confirmed use.

## Evidence

`node scripts/verify-dictation.mjs` checks the real gateway plus the built desk with controlled capture/provider transport. `--live-audio /path/to/synthetic.wav` (add `--ollama` for local acceptance) performs one explicitly selected real provider request and checks expected text; it must not be used with private audio. `--serve --no-desk` exposes a disposable local UI fixture. No unit/Jest/Vitest runner is used.

Controlled gateway and built-desk checks passed before OA-433: owner/Limited access, strict settings, stale target, invalid/oversized input, second call, nested/HTTP/empty/oversized results, concurrency, revocation, draft preservation during typing, second dictation, Send locking, cancellation, denied permission and late microphone release. OA-433 extends that controlled built-desk path with active empty-prompt labels, one live status, placeholder removal, typing/clearing, attachment preservation, empty-to-filled insertion and Cancel/error restoration; its rerun and local rendered review remain recorded in the OA-433 ticket. Live OpenAI GPT Transcribe and local Ollama LFM3-Omni requests through the isolated gateway each matched the synthetic dictation sentence. LFM3-Omni was installed with explicit owner approval; the pre-existing chat model has no audio capability. Desktop Chrome captured real microphone audio into the controlled provider path and preserved a pre-existing draft after Stop and after a second capture/Cancel. Desktop Chrome at an emulated 390-pixel viewport also captured microphone audio, converted it to WAV and inserted the real local Ollama response. The response did not match the synthetic sentence played aloud, so microphone recognition accuracy is unverified; this capture was not retried. No physical phone or Safari acceptance is claimed.

Knowledge: the delivered dictation topic plus conversations and bots-models guidance link here; the dictation manifest entry includes this authoritative source. Packaging/delivery verification is recorded with the implementation ticket. No ACP/tool identity checks are required because no bot invocation path changed.

The full verification matrix is recorded in OA-432 evidence.

## Capability discovery update

Settings → Models → Refresh models refreshes transcription choices together with
chat and routing choices. Dictation's model menu is populated from that saved
catalogue, filtered to recorded-file support on the implemented OpenAI/Ollama
transports. Ollama models must report audio capability. The UI and settings
schema no longer enumerate model names. New identities require a current
per-model catalogue token; stale selections are refused. Opening dictation or
saving does not run discovery. Missing metadata preserves existing saved settings;
a successfully refreshed source that no longer lists the selected model makes it
unavailable until the owner chooses a replacement. No automatic retry or fallback.

OpenAI file requests use the documented automatic chunking strategy for recordings
that need segmentation, including diarization-capable models. The composer still
receives plain transcript text; speaker-labelled output and realtime input are not
implemented. Supported endpoint metadata does not prove account access or recognition
quality. See [shared model discovery](model-picker.md).
