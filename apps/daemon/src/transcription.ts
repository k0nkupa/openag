import { providerCredential } from './providers.js';
import { getDefaultRedactor } from './redact.js';
import type { ModelCapabilities } from './model-capabilities.js';
import type { Settings } from './settings.js';

export const AUDIO_MAX_BYTES = 8 * 1024 * 1024;
export class TranscriptionError extends Error {
  constructor(message: string, public status: 400 | 409 | 413 | 429 | 502 | 503 | 504 = 400) { super(message); }
}
export function localTranscriptionOrigin(raw = process.env.OPENAG_OLLAMA_URL || 'http://127.0.0.1:11434'): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Local dictation requires a loopback Ollama URL');
  return url.origin;
}
async function readResult(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TranscriptionError('Transcription provider returned no result', 502);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 64 * 1024) throw new TranscriptionError('Transcription result exceeds the limit', 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new TranscriptionError('Transcription provider returned an invalid result', 502); }
}
export async function transcriptionStatus(setting: Settings['dictation'], _fetchImpl: typeof fetch = fetch, capability?: ModelCapabilities, present?: boolean) {
  let local = true;
  if (setting.provider === 'ollama') try { localTranscriptionOrigin(); } catch { local = false; }
  const configured = local && !!setting.model && present !== false && (setting.provider === 'ollama' || !!providerCredential('openai')) && capability?.transcription !== false;
  const reason = !local ? 'Local dictation requires a loopback HTTP Ollama address' : present === false ? 'The selected model is no longer listed. Refresh models and choose a replacement.' : !setting.model ? 'Choose a transcription model in Settings, Models' : capability?.transcription === false ? 'The selected model does not support recorded transcription. Choose another model.' : 'Set OPENAI_API_KEY on the daemon to use dictation';
  return { ...setting, target: `${setting.provider}/${setting.model}`, configured,
    available: setting.enabled && configured, reason: !setting.enabled ? 'Enable dictation in Settings, Models' : configured ? '' : reason,
    maxBytes: AUDIO_MAX_BYTES, maxSeconds: 120 };
}

/** One completed recording, one provider request. No retries or provider fallback. */
export async function transcribe(bytes: Uint8Array, mime: string, setting: Settings['dictation'], signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!bytes.length || bytes.length > AUDIO_MAX_BYTES) throw new TranscriptionError('Recording is empty or exceeds 8 MiB', 413);
  const b = Buffer.from(bytes);
  const extension = mime === 'audio/webm' && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'webm'
    : mime === 'audio/mp4' && b.toString('ascii', 4, 8) === 'ftyp' ? 'mp4'
    : mime === 'audio/wav' && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' ? 'wav' : null;
  if (!extension) throw new TranscriptionError('Unsupported or invalid recording; use WebM, MP4 or WAV audio');
  if (setting.provider === 'ollama' && extension !== 'wav') throw new TranscriptionError('Local Ollama dictation requires WAV audio');
  const key = providerCredential('openai');
  if (setting.provider === 'openai' && !key) throw new TranscriptionError('Set OPENAI_API_KEY on the daemon to use dictation', 503);
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `dictation.${extension}`);
  body.append('model', setting.model);
  if (setting.provider === 'openai') body.append('chunking_strategy', 'auto');
  const timeout = AbortSignal.timeout(60_000);
  try {
    signal.throwIfAborted();
    const endpoint = setting.provider === 'ollama' ? localTranscriptionOrigin() + '/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: setting.provider === 'openai' ? { authorization: `Bearer ${key}` } : {}, body, redirect: 'error', signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TranscriptionError(`Transcription provider refused the request (HTTP ${response.status})`, 502);
    }
    const result = await readResult(response);
    if (!result || typeof result !== 'object' || 'error' in result || !('text' in result) || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 16000) throw new TranscriptionError('No usable transcript was returned', 502);
    return getDefaultRedactor().redactString(result.text.trim());
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('Transcription is unconfirmed. Your draft is kept; no retry was sent.', timeout.aborted ? 504 : 502);
  }
}
