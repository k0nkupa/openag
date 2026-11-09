# Composer dictation domain model

4 November 2026. Proposed behavior following [primary-source research](composer-dictation-research.md). This is design work; dictation is not implemented or accepted. The named OpenBoard/OpenMuse identities remain assumptions as recorded in the research.

## Domain boundaries

Dictation edits a message draft. Transcription converts captured speech into text. Sending submits the edited message through existing conversation ingress. These are separate actions: successful transcription proves neither submission nor an agent response.

The installation selects a transcription target independently of its agents' chat models. Reuse existing daemon-held provider credentials where applicable, but require an explicit supported transcription contract. Credential presence, documented capability and successful transcription are separate evidence. A Claude or Codex subscription login does not establish a reusable speech API credential.

The initial implementation should offer supported targets only. OpenAI is a documented candidate. Current Ollama documentation also specifies transcription, but its WAV requirement, installed version and audio model must be verified before offering it. The inspected Anthropic Messages contract does not establish native transcription. A Claude chat can receive a draft transcribed by OpenAI or a verified local service. Do not infer transcription support from Mastra's chat catalogue or add speech models to the chat picker.

## Proposed journey and ownership

1. The user starts dictation in the current composer. Request microphone permission on this action.
2. Capture a bounded recording with a format supported by both browser and transcription target. Show Recording, Stop and Cancel through shared controls.
3. Stop releases the microphone and starts one bounded transcription request. Pin the target and originating composer for this attempt.
4. Successful nonempty text appends to the originating draft with appropriate spacing, preserving text and attachments already there. Use the current draft at insertion time so typing during transcription is retained. Put the caret after inserted text.
5. The user edits and sends through the existing Send path. Block Send during capture/transcription so an in-flight transcript cannot land in a subsequent message draft.

Cancel releases capture and invalidates pending results. Leaving the conversation invalidates the attempt; a late result must never enter another room. Abort an in-flight request where possible, without claiming that cancellation undoes provider processing or billing. Audio stays transient and is not a conversation attachment or durable recording library. No automatic retry or fallback to another provider.

## Scenarios that constrain the model

| Scenario | Required behavior |
| --- | --- |
| Dictation in a Claude, Codex or Ollama chat | Use the selected transcription target; preserve the addressed agent and chat configuration. |
| A room routes dynamically or addresses everyone | Dictation still has one explicit transcription target, independent of routing. |
| User types while transcription runs | Preserve those edits; append only once to the current originating draft. |
| User changes the target during a request | The pending attempt retains its original target; never silently send audio elsewhere. |
| User cancels, navigates away or loses access | Stop capture, invalidate the attempt and discard late text. Recheck authority at the daemon boundary. |
| Permission denied, unavailable microphone or incompatible format | Preserve the draft and show the specific actionable error. Never submit an empty message. |
| Empty transcript or nested provider error | Report no usable transcription; HTTP success alone is insufficient. |
| Provider times out with uncertain processing | Preserve the draft, report uncertainty and do not replay automatically. |
| A Limited device can send messages | Dictation should follow conversation access, not require Full merely to compose. Full/owner manages installation configuration. |
| Phone connects through plain LAN HTTP | Do not promise microphone access; verify the actual secure browser route. |

## Source agreement and implementation reach

- `apps/desk/src/components/Composer.tsx` owns draft text, attachment state and Send. `RoomView.tsx` supplies conversation context and availability. `App.tsx` keys RoomView by room identity. Capture and pending-result cleanup must follow that lifecycle.
- `apps/daemon/src/providers.ts` owns provider credential lookup and secret registration. Its chat filtering deliberately excludes speech families. `models.ts` reports chat/decision and credential status; it does not currently establish transcription readiness.
- `apps/daemon/src/runtimes/ollama.ts` implements chat through `/api/chat`; the current implementation does not establish Ollama transcription support.
- `uploads.ts` accepts bounded text and PNG/JPEG files, not audio. `gateway.ts` has a global 1 MiB body cap and a narrow upload exception. Add a bounded authenticated audio path with its own validation; do not widen normal attachments or all request limits. Any new top-level route needs `static.ts` API registration. Check RTC path/size limits before promising that transport.
- The desk API client, provider settings/status, request cancellation and sanitized error reporting need the same capability contract. Keep audio and draft transcript content out of shared logs, ledger and product knowledge; submitted text still follows existing ingress/redaction.

No generic connector framework, voice replies, realtime conversation, silence detection, auto-send or provider fallback is needed for this slice. Format conversion is an unresolved implementation prerequisite for WAV-only targets, not evidence that every browser can use them today. Limits, provider timeout and the first supported target must be selected and checked during implementation.

## Verification and knowledge handoff

Before completion, verify a real microphone-to-draft journey on each offered browser/provider route, including an existing draft and a second dictation. Exercise the scenarios above with controlled non-unit checks. Verify the rendered controls against shared compositions and record component-audit coverage. Do not claim deployment or user acceptance from source checks.

Implementation must update the authoritative behavior note, delivered conversations/model setup help and bot-facing knowledge references, then check packaging and delivery with the existing knowledge verifier. This research/design pass changes no runtime capability or help promise, so delivered help remains unchanged. No ADR is needed: the proposed choices remain inexpensive to revise before implementation. No unit/Jest tests or live provider calls were run for this pass.
