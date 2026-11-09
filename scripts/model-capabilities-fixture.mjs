// Capability evidence for controlled integration transports; never fetched by production.
export const capabilityUrl = 'https://models.dev/experimental/v2.0/api.json';
export const chatDefinition = { type: 'chat', modalities: { input: ['text', 'image/png', 'image/jpeg'], output: ['text'] }, api: { responses: {}, 'chat-completions': {}, messages: {}, 'generate-content': {} } };
export const transcriptionDefinition = { type: 'transcription', modalities: { input: ['audio/wav', 'audio/webm', 'audio/mp4'], output: ['text'] }, api: { transcriptions: {} } };
export const capabilityFixture = {
 openai: { models: Object.fromEntries(['gpt-5', 'gpt-4o-mini', 'arbitrary-new-model', 'voice-transcribe-image-name'].map(id => [id, chatDefinition]).concat(['gpt-transcribe','gpt-4o-transcribe','gpt-4o-mini-transcribe','unfamiliar-file-model'].map(id=>[id, transcriptionDefinition]), [['wrong-chat-protocol', { ...chatDefinition, api: { 'chat-completions': {} } }], ['live-only', { ...transcriptionDefinition, api: { realtime: {} } }], ['future-decision', { ...chatDefinition, api: { decisions: {} } }]])) },
 anthropic: { models: Object.fromEntries(['claude-opus-4-6','claude-opus-5'].map(id => [id, chatDefinition])) },
 openrouter: { models: { 'openai/gpt-5': chatDefinition, 'vendor/new-decision': { ...chatDefinition, api: { systemone: {} } } } },
};
