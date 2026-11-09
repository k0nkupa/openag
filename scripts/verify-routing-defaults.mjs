// Run with node --import ./scripts/routing-fetch-fixture.mjs scripts/verify-routing-defaults.mjs
import assert from 'node:assert/strict';
import {routeWithChat} from '../apps/daemon/dist/router-chat.js';
for(const [provider,model,env]of [
 ['nebius','nebius/Qwen/Qwen3.8-27B',{NEBIUS_API_KEY:'synthetic-key'}],
 ['togetherai','togetherai/openai/gpt-oss-120b',{TOGETHER_API_KEY:'synthetic-key'}],
 ['vercel','vercel/openai/gpt-5',{AI_GATEWAY_API_KEY:'synthetic-key'}],
 ['netlify','netlify/openai/gpt-5',{NETLIFY_TOKEN:'synthetic-netlify-token',NETLIFY_SITE_ID:'fixture-normal'}],
]){
 console.log("Checking default routing:",provider);
 const text=await routeWithChat({provider,model,reasoning:{effort:'low'}},'Choose coder',env);
 assert.equal(text,'coder',provider);
}
await assert.rejects(routeWithChat({provider:'netlify',model:'netlify/openai/gpt-5',reasoning:{}},'Choose coder',{NETLIFY_TOKEN:'synthetic-netlify-token',NETLIFY_SITE_ID:'fixture-bad-host'}),/failed/);
console.log('PASS: real SDK routing resolves default catalogue, Together, Vercel and Netlify endpoints, forwards native gateway reasoning, and rejects a foreign Netlify token endpoint. All fetches intercepted; no real network.');
