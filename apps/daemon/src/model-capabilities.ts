import { z } from 'zod';

export const CAPABILITY_URL = 'https://models.dev/experimental/v2.0/api.json';
export const capabilityState = z.union([z.boolean(), z.literal('unknown')]);
export const capabilitySchema = z.object({
  chat: capabilityState, image: capabilityState, transcription: capabilityState,
  decision: capabilityState, embedding: capabilityState,
  input: z.array(z.string().max(100)).max(100),
  source: z.string().max(500), refreshedAt: z.number().int().nonnegative(),
});
export type ModelCapabilities = z.infer<typeof capabilitySchema>;
export type ModelTask = 'chat' | 'image' | 'transcription' | 'decision' | 'embedding';
const protocols = z.record(z.string().max(100), z.unknown());
const definition = z.object({
  id: z.string().max(200).optional(), name: z.string().max(200).optional(),
  type: z.string().max(100).optional(),
  modalities: z.object({ input: z.array(z.string().max(100)).max(100), output: z.array(z.string().max(100)).max(100) }).optional(),
  api: protocols.optional(),
});
export type ModelDefinition = z.infer<typeof definition>;
const feedSchema = z.record(z.string().max(200), z.object({ models: z.record(z.string().max(200), definition) }));
export type CapabilityFeed = z.infer<typeof feedSchema>;
export function unknownCapabilities(source = 'No capability metadata', refreshedAt = 0): ModelCapabilities {
  return { chat: 'unknown', image: 'unknown', transcription: 'unknown', decision: 'unknown', embedding: 'unknown', input: [], source, refreshedAt };
}

export function catalogueCapabilities(model: ModelDefinition | undefined, refreshedAt: number): ModelCapabilities {
  const result = unknownCapabilities(CAPABILITY_URL, refreshedAt);
  if (!model) return result;
  const api = model.api;
  const has = (...keys: string[]) => keys.some(key => api && Object.hasOwn(api, key));
  if (api) {
    result.chat = model.type === undefined ? 'unknown' : model.type === 'chat' && has('responses', 'chat-completions', 'messages', 'generate-content', 'converse');
    result.transcription = has('transcriptions');
    result.decision = has('decisions', 'systemone');
    result.embedding = has('embeddings', 'embed-content');
  }
  if (model.modalities) {
    result.input = model.modalities.input;
    result.image = model.modalities.input.some(type => type === 'image' || type.startsWith('image/'));
  }
  return result;
}

/** Provider metadata takes precedence only for fields it actually reports. */
export function providerCapabilities(raw: unknown, base: ModelCapabilities, source: string): ModelCapabilities {
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, any>, result = { ...base };
  const modes = value.architecture;
  if (Array.isArray(modes?.input_modalities) && modes.input_modalities.every((v: unknown) => typeof v === 'string')) {
    result.image = modes.input_modalities.includes('image'); result.input = modes.input_modalities.slice(0, 100);
  }
  if (Array.isArray(modes?.output_modalities) && modes.output_modalities.includes('decisions')) {
    result.decision = true;
  }
  if (value.type === 'chat') result.chat = true;
  if (value.type === 'embedding') { result.embedding = true; result.chat = false; }
  if (Array.isArray(value.capabilities)) {
    const caps = value.capabilities;
    result.chat = caps.includes('completion'); result.image = caps.includes('vision');
    result.embedding = caps.includes('embedding'); result.transcription = caps.includes('audio');
    result.decision = caps.includes('decision');
    result.input = result.transcription ? ['audio/wav'] : result.input;
  }
  if (value.capabilities && !Array.isArray(value.capabilities) && typeof value.capabilities === 'object') {
    const image = value.capabilities.image_input?.supported;
    if (typeof image === 'boolean') result.image = image;
  }
  if (JSON.stringify(result) !== JSON.stringify(base)) result.source = `${base.source} + ${source}`;
  return capabilitySchema.parse(result);
}

export async function fetchCapabilityFeed(doFetch: typeof fetch, signal?: AbortSignal): Promise<CapabilityFeed> {
  const response = await doFetch(CAPABILITY_URL, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
  if (!response.ok || !response.body) throw new Error('Capability catalogue unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 16 * 1024 * 1024) throw new Error('Capability catalogue exceeds 16 MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = feedSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (!Object.keys(data).length) throw new Error('Empty capability catalogue');
  return data;
}
