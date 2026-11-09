import { PROVIDER_REGISTRY } from "@mastra/core/llm";
import { getDefaultRedactor } from "./redact.js";

/** Mastra owns the provider catalogue; the extra provider serves decisions rather than chat. */
const providers = Object.entries(PROVIDER_REGISTRY).map(([id, p]) => ({
    id, name: p.name, envVars: Array.isArray(p.apiKeyEnvVar) ? p.apiKeyEnvVar : [p.apiKeyEnvVar],
    envMode: id === "netlify" ? "all" : "any", chat: p.models.length > 0, decisions: id === "openai" || id === "openrouter", docUrl: p.docUrl,
  })).concat([{ id: "typesafe", name: "Typesafe", envVars: ["TYPESAFE_API_KEY"], envMode: "any", chat: false, decisions: true, docUrl: "https://docs.typesafe.ai/api/system-one" }]).sort((a, b) => a.name.localeCompare(b.name));
export function modelProviders() { return providers; }
const providerIds = new Set(Object.keys(PROVIDER_REGISTRY));
export function registeredProvider(id: string) {
  return providerIds.has(id) ? PROVIDER_REGISTRY[id as keyof typeof PROVIDER_REGISTRY] : undefined;
}
export function providerCredential(id: string, env: NodeJS.ProcessEnv = process.env) {
  const provider = modelProviders().find(p => p.id === id);
  if (provider?.envMode === "all" && !provider.envVars.every(name => env[name])) return undefined;
  return provider?.envVars.map(name => env[name]).find(Boolean);
}
export function registerProviderSecrets(env: NodeJS.ProcessEnv) {
  for (const name of new Set(modelProviders().flatMap(p => p.envVars))) if (env[name]) getDefaultRedactor().addSecret(env[name]!);
}
