import { requestAttachments, prepareRequest, type ContextProjection } from '../request-provenance.js';
import { retryModelRequest, requestOutcome, ModelHttpError, type RetryOptions } from './model-retries.js';
import { hostedLimits, beginModelStep, modelToolResult, hostedOutcome, stopHosted } from './hosted-execution.js';
import { attachmentText } from "../attachment-prompt.js";
import { prepareTurnInput } from "../prompt.js";
import { defaultToolDefs } from "../tools/index.js";
import { enabledTools, toolSchema, type ToolDef } from "../tools/registry.js";
import { INVALID_MODEL_OVERRIDE, modelOverride, modelConfig, recordModel } from "../botmodels.js";
import type { BotRuntime, TurnContext } from "./types.js";

/**
 * Local chat models through Ollama (`POST /api/chat`). A bot uses it when its model is `ollama/<name>` (runtime `api`):
 * the model name is the bot's `model` (or OPENAG_<BOTID>_MODEL). Configuration is SEPARATE from the embedding path
 * (`OPENAG_EMBED_*`): `OPENAG_OLLAMA_URL` (default http://127.0.0.1:11434).
 *
 * - Every tool call goes through `ctx.callTool` (the gate); the runtime never executes a tool itself.
 * - Fail soft: Ollama down, model missing, timeouts and bad answers become ONE short, fixed error (the runner records it
 *   as a ledger `error` and the turn as failed); nothing else is affected.
 * - The server's reply is untrusted text: capped, `<think>` blocks removed, never executed.
 */

export const OLLAMA_PREFIX = "ollama/";
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/;
const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const REPLY_MAX_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;


export class OllamaError extends Error {}

export interface OllamaRuntimeOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Tool definitions to expose (default: the built-in file tools). */
  tools?: ToolDef[];
  /** Extra definitions read at each turn (MCP servers, apps, first-party), added to `tools`. */
  toolDefs?: () => ToolDef[];
  maxRounds?: number;
  timeoutMs?: number;
  retry?:RetryOptions;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  tool_name?: string;
}

/** The Ollama model name for a bot, or null when the bot does not use Ollama. */
/** True when the bot is configured for a local model, even if the name is invalid (then the turn fails clearly). */
export function isOllamaBot(botId: string, botModel: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const fromEnv = env[`OPENAG_${botId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MODEL`];
  return (fromEnv ?? botModel ?? "").startsWith(OLLAMA_PREFIX);
}

export function ollamaModelOf(botId: string, botModel: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[`OPENAG_${botId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MODEL`];
  const id = fromEnv ?? botModel ?? "";
  if (!id.startsWith(OLLAMA_PREFIX)) return null;
  const name = id.slice(OLLAMA_PREFIX.length);
  return MODEL_RE.test(name) ? name : null;
}

function baseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.OPENAG_OLLAMA_URL || DEFAULT_URL;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new OllamaError("OPENAG_OLLAMA_URL is not a valid URL");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) throw new OllamaError("OPENAG_OLLAMA_URL must be an http(s) URL without credentials");
  return `${u.origin}`;
}

/** Strips reasoning blocks some local models emit. */
export function cleanReply(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Some templates emit the reasoning WITHOUT the opening tag (seen with a real qwen model): keep what follows the last closer.
  const closer = out.toLowerCase().lastIndexOf("</think>");
  if (closer !== -1) out = out.slice(closer + "</think>".length);
  return out.replace(/^\s*<think>[\s\S]*$/i, "").trim();
}

export function createOllamaRuntime(opts: OllamaRuntimeOptions = {}): BotRuntime {
  const env = opts.env ?? process.env;
  const doFetch: typeof fetch = (i, init) => (opts.fetch ?? fetch)(i, init);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function chat(ctx:TurnContext,url: string, model: string, messages: OllamaMessage[], tools: unknown[], signal?: AbortSignal, think?: string | boolean | number,context?:ContextProjection,vision=false): Promise<{ message: OllamaMessage; model?: string; doneReason?:string }> {
    const trace=prepareRequest(ctx,{boundary:'ollama-payload',model,messages,tools,settings:{think},context,attachments:requestAttachments(ctx.attachments,vision)});
    return retryModelRequest(ctx,async signal=>{
      const res=await doFetch(`${url}/api/chat`,{
        method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({model,messages,stream:false,...(think!==undefined?{think}:{}),...(tools.length?{tools}:{})}),
      });
      if(!res.ok){void res.body?.cancel().catch(()=>{});throw new ModelHttpError(res.status,Object.fromEntries(['retry-after','retry-after-ms'].flatMap(key=>res.headers.has(key)?[[key,res.headers.get(key)!]]:[])),res.status===404?`ollama model "${model}" is not installed (run: ollama pull ${model})`:`ollama error ${res.status}`);}
      const text=await readCapped(res);let json:unknown;
      try{json=JSON.parse(text);}catch{throw new OllamaError('ollama sent an unexpected response');}
      const message=(json as {message?:OllamaMessage})?.message;
      if(!message||typeof message!=='object')throw new OllamaError('ollama sent an unexpected response');
      return {...(typeof(json as {prompt_eval_count?:unknown}).prompt_eval_count==='number'?{prompt_eval_count:(json as {prompt_eval_count:number}).prompt_eval_count}:{}),...(typeof(json as {eval_count?:unknown}).eval_count==='number'?{eval_count:(json as {eval_count:number}).eval_count}:{}),message,doneReason:(json as {done?:unknown}).done===true&&typeof(json as {done_reason?:unknown}).done_reason==='string'?(json as {done_reason:string}).done_reason:undefined,model:typeof(json as {model?:unknown}).model==='string'?(json as {model:string}).model:undefined};
    },{...opts.retry,windowMs:Math.min(opts.retry?.windowMs??300_000,timeoutMs)},trace);
  }

  return {
    async runTurn(ctx: TurnContext) {
      if (modelOverride(ctx.bot, env) === INVALID_MODEL_OVERRIDE) throw new OllamaError(INVALID_MODEL_OVERRIDE);
      const model = ollamaModelOf(ctx.bot.id, ctx.bot.model, env);
      if (!model) throw new OllamaError(`bot ${ctx.bot.id} has no valid ollama model (set its model to ollama/<name>)`);
      const url = baseUrl(env);
      const defs=enabledTools([...(opts.tools??defaultToolDefs),...(opts.toolDefs?.()??[])]).filter(def=>ctx.investigation?def.name==='investigation_read':def.name!=='investigation_read');
      const byName=new Map(defs.map(d=>[d.name,d] as const));
      const tools=defs.map(d=>({type:'function',function:{name:d.name,description:d.description,parameters:toolSchema(d)}}));
      // Admission precedes capability probes as well as chat generation.
      const imageText=attachmentText(ctx.attachments,true,true),plainText=attachmentText(ctx.attachments,true,false);
      prepareTurnInput(ctx,imageText.length>plainText.length?imageText:plainText,tools,ctx.hostedInput,model);
      const recall=await ctx.loadHostedRecall?.()??[];
      ctx.signal?.throwIfAborted();
      const selectedThink = modelConfig(ctx.bot).reasoning?.think;
      let vision = false;
      if (ctx.attachments?.some(file => file.data)) {
        try {
          const response = await doFetch(`${url}/api/show`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(ctx.signal ? [ctx.signal] : [])]) });
          const info = JSON.parse(await readCapped(response)) as { capabilities?: unknown };
          vision = response.ok && Array.isArray(info.capabilities) && info.capabilities.includes("vision");
        } catch { ctx.signal?.throwIfAborted(); }
      }
      const prepared=prepareTurnInput(ctx,attachmentText(ctx.attachments,true,vision),tools,{...ctx.hostedInput!,data:[...ctx.hostedInput!.data,...recall]},model);
      const messages:OllamaMessage[]=[{role:'system',content:prepared.instructions},...prepared.messages.map((message,index)=>index===prepared.messages.length-1&&vision?
        {...message,images:ctx.attachments?.flatMap(file=>file.data?[file.data]:[])}:{...message})];
      const limit=hostedLimits(ctx,opts.maxRounds).maxSteps;
      let finish:string|undefined,unresolved=false;
      let final = "";
      for (; Number(ctx.state.hostedSteps??0)<limit;) {
        beginModelStep(ctx,limit);
        ctx.signal?.throwIfAborted();
        let response;
        try{response=await chat(ctx,url,model,messages,tools,ctx.signal,modelConfig(ctx.bot).reasoning?.think,prepared.projection,vision);}
        catch(error){ctx.signal?.throwIfAborted();const stopped=requestOutcome(ctx);if(stopped){if(final)ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:cleanReply(final).slice(0,REPLY_MAX_CHARS)});return stopped;}throw error;}
        const {message,model:returnedModel,doneReason}=response;
        if (returnedModel) recordModel(ctx, { model: returnedModel, source: "response" }, env);
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        final = typeof message.content === "string" ? message.content : "";
        finish=doneReason;unresolved=calls.length>0;
        if (calls.length === 0) break;
        const used = calls;
        messages.push({ role: "assistant", content: final, tool_calls: used });
        for (const call of used) {
          const name = call?.function?.name;
          // Own entries only: a model-chosen name like "constructor" must not resolve.
          let content: string;
          if (typeof name !== "string" || !byName.has(name)) {
            content = JSON.stringify({ error: "unknown tool" });
          } else {
            const outcome = await ctx.callTool(name, call.function.arguments ?? {});
            content = JSON.stringify(modelToolResult(ctx,outcome));
          }
          messages.push({ role: "tool", tool_name: typeof name === "string" ? name : "unknown", content });
        }
        if(ctx.state.hostedStop)break;
      }
      ctx.signal?.throwIfAborted();
      if(cleanReply(final).length>REPLY_MAX_CHARS)stopHosted(ctx,'output_truncated');
      const text = cleanReply(final).slice(0, REPLY_MAX_CHARS);
      ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: text || "(no answer)" });
      return hostedOutcome(ctx,finish,unresolved,Number(ctx.state.hostedSteps??0)>=limit);
    },
  };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new OllamaError("ollama sent too much data");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}
