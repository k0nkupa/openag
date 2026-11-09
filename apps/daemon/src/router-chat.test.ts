import { expect, test } from "vitest";
import { PROVIDER_REGISTRY } from "@mastra/core/llm";
import { routingOrigin } from "./router-chat.js";

test("resolves registry and native provider endpoints without making network calls", () => {
  expect(routingOrigin({ provider: "nebius", model: "nebius/Qwen/Qwen3.8-27B" }, {})).toBe("https://api.tokenfactory.nebius.com");
  expect(routingOrigin({ provider: "togetherai", model: "togetherai/fixture" }, {})).toBe("https://api.together.xyz");
  expect(routingOrigin({ provider: "vercel", model: "vercel/openai/gpt-5" }, {})).toBe("https://ai-gateway.vercel.sh");
  expect(routingOrigin({ provider: "netlify", model: "netlify/openai/gpt-5" }, {})).toBe("https://api.netlify.com");
  const tenantEnv = { DATABRICKS_HOST: "fixture.cloud.databricks.com", NEON_AI_GATEWAY_BASE_URL: "https://br-fixture.us-east-2.aws.neon.tech", SNOWFLAKE_ACCOUNT: "fixture.us-east-1", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", INFOMANIAK_PRODUCT_ID: "12345" };
  for (const [provider, p] of Object.entries(PROVIDER_REGISTRY)) {
    const env = tenantEnv;
    expect(routingOrigin({ provider, model: `${provider}/${p.models[0]}` }, env), provider).toMatch(/^https:\/\/|^http:\/\/(?:127\.0\.0\.1|localhost)/);
  }
});
test("refuses unknown providers and unsafe administrator endpoints", () => {
  expect(() => routingOrigin({ provider: "constructor", model: "constructor/x" }, {})).toThrow("unavailable");
  for (const NEBIUS_BASE_URL of ["http://untrusted.example", "https://attacker.example", "https://user:secret@api.tokenfactory.nebius.com/v1"]) expect(() => routingOrigin({ provider: "nebius", model: "nebius/x" }, { NEBIUS_BASE_URL })).toThrow("unavailable");
});

test("tenant configuration cannot change the provider host or inject URL syntax", () => {
  for (const [provider, env] of [
    ["databricks", { DATABRICKS_HOST: "attacker.example" }],
    ["databricks", { DATABRICKS_HOST: "fixture.cloud.databricks.com/../../attacker" }],
    ["neon", { NEON_AI_GATEWAY_BASE_URL: "https://attacker.example" }],
    ["neon", { NEON_AI_GATEWAY_BASE_URL: "https://attacker.example/fixture.neon.tech" }],
    ["snowflake-cortex", { SNOWFLAKE_ACCOUNT: "attacker.example/" }],
    ["infomaniak", { INFOMANIAK_PRODUCT_ID: "../other" }],
    ["cloudflare-workers-ai", { CLOUDFLARE_ACCOUNT_ID: "../other" }],
  ] as Array<[string, NodeJS.ProcessEnv]>) expect(() => routingOrigin({ provider, model: `${provider}/fixture` }, env)).toThrow("endpoint");
});
