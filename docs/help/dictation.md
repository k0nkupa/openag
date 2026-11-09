# Composer dictation

Enable dictation in Settings → Models → Dictation with owner/Full access. OpenAI uses the daemon’s existing OPENAI_API_KEY. Subscription sign-in alone does not supply API access. API audio processing may incur usage charges.

In any chat or room, click Dictate message, allow microphone access and speak. Stop transcribes and appends text to your current draft. Cancel discards the recording. Review or edit the text, then Send. Dictation does not select the agent’s chat model or grant tools new permissions.

With an empty draft, Starting microphone, Recording or Transcribing replaces the normal message prompt. It is a subtle activity indicator, not typed text. Start typing to restore the ordinary editor view; clear the draft during capture to show the status in the prompt again. If text is already present, the compact status remains above it. Reduced-motion preference shows the same status without animation.

Recording and transcription block Send. Typed text and attachments stay in the draft. Cancelling or leaving the chat discards late results. Capture stops after two minutes; recordings are limited to 8 MiB. OpenAg keeps audio transient and does not add it to conversation history. Provider processing or billing may already have occurred when a request is cancelled or times out; no automatic retry or provider fallback occurs.

Use a supported browser on HTTPS or localhost. The current WebRTC connection does not carry recording audio; use LAN or Tailscale through a secure browser address. Credential presence is not proof of model access. See [composer dictation](../notes/composer-dictation.md) for the supported targets, exact limits and scoped verification evidence.

For local speech-to-text, install an audio-capable Ollama model on the daemon host, use Settings → Models → Refresh models, then select it under Dictation. OpenAg uses reported audio capability from that refresh. The local endpoint must be on loopback; no OpenAI key is used for local transcription.

The transcription model menu uses discovered recorded-file capabilities, rather
than a fixed model list. Realtime-only models are excluded. Refreshing preserves
your unsaved selection, but saving requires current catalogue metadata. Existing
saved targets are not automatically replaced. See
[shared model discovery](../notes/model-picker.md).
