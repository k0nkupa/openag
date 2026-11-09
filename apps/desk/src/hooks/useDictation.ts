import { useEffect, useRef, useState } from 'react';
import { ApiError, messageOf, type Api } from '../api';

export function useDictation(api: Api, roomId: string, disabled: boolean, onText: (text: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0), busy = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), controller = useRef<AbortController | null>(null);
  const receive = useRef(onText); receive.current = onText;
  function release() {
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null; recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop(); recorder.current = null; }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }
  function cancel() { generation.current++; busy.current = false; controller.current?.abort(); controller.current = null; release(); setPhase('idle'); }
  useEffect(() => () => { generation.current++; busy.current = false; controller.current?.abort(); release(); }, [api, roomId]);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  function stop() {
    if (recorder.current?.state !== 'recording') return;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    setPhase('transcribing'); recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }
  async function start() {
    if (disabled || busy.current) return;
    busy.current = true; const attempt = ++generation.current;
    setError(null); setPhase('starting');
    const current = () => generation.current === attempt;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording needs a supported browser on HTTPS or localhost.');
      const status = await api.getDictation();
      if (!current()) return;
      if (!status.available) throw new Error(status.reason);
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('This browser cannot record a supported audio format.');
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current()) { capture.getTracks().forEach(track => track.stop()); return; }
      stream.current = capture;
      const audio = new MediaRecorder(capture, { mimeType: mime, audioBitsPerSecond: 64000 }); recorder.current = audio;
      const chunks: Blob[] = []; let bytes = 0;
      audio.ondataavailable = event => {
        if (!current()) return;
        bytes += event.data.size;
        if (bytes > status.maxBytes) { cancel(); setError('Recording exceeds 8 MiB. Record a shorter message.'); return; }
        chunks.push(event.data);
      };
      audio.onerror = () => { if (current()) { cancel(); setError('Microphone recording failed. Your draft is kept.'); } };
      audio.onstop = async () => {
        if (!current()) return;
        setPhase('transcribing'); release();
        const request = new AbortController(); controller.current = request;
        const deadline = setTimeout(() => request.abort(), 65000);
        try {
          let blob = new Blob(chunks, { type: mime });
          if (status.provider === 'ollama') blob = await recordingWav(blob);
          if (!current()) return;
          if (!blob.size) throw new Error('No audio was recorded.');
          const result = await api.transcribe(roomId, blob, status.target, request.signal);
          if (current()) receive.current(result.text);
        } catch (err) { if (current()) setError((request.signal.aborted || (err instanceof ApiError && err.status === 0)) ? 'Transcription is unconfirmed. Your draft is kept; no retry was sent.' : messageOf(err)); }
        finally { clearTimeout(deadline); if (current()) { busy.current = false; controller.current = null; setPhase('idle'); } }
      };
      audio.start(250); setPhase('recording');
      timer.current = setTimeout(stop, status.maxSeconds * 1000);
    } catch (err) { if (current()) { release(); busy.current = false; setPhase('idle'); setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser site settings.' : err instanceof DOMException && err.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : messageOf(err)); } }
  }
  return { phase, error, start, stop, cancel, isBusy: () => busy.current };
}

/** Decode at 16 kHz, downmix to mono and encode PCM16 WAV for Ollama's audio endpoint. */
export async function recordingWav(recording: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 16000);
  const audio = await context.decodeAudioData(await recording.arrayBuffer());
  if (!audio.length || audio.duration > 121 || audio.numberOfChannels > 8) throw new Error('Recording is empty or exceeds two minutes.');
  const buffer = new ArrayBuffer(44 + audio.length * 2), view = new DataView(buffer);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, audio.length * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i]!, 0) / channels.length));
    view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
