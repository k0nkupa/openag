import { requestAttachments, prepareRequest } from '../request-provenance.js';
import { resolveModelConfig, type MastraModelConfig } from '@mastra/core/llm';
import { retryModelRequest, requestOutcome, type RetryOptions } from './model-retries.js';
import { hostedLimits, beginModelStep, modelToolResult, hostedOutcome } from './hosted-execution.js';
import { prepareTurnInput } from "../prompt.js";
import { reasoningSettings } from "../hostedmodels.js";
import { INVALID_MODEL_OVERRIDE, modelOverride, modelConfig, modelTarget, providerOptions, recordModel } from "../botmodels.js";
import { attachmentText, apiImageInput } from "../attachment-prompt.js";
import { Agent, type AgentExecutionOptionsBase } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { defaultToolDefs } from "../tools/index.js";
import { enabledTools, toolSchema, type ToolDef } from "../tools/registry.js";
import { isOllamaBot } from "./ollama.js";
import type { BotRuntime, TurnContext } from "./types.js";

import type { ModelCapabilities } from "../model-capabilities.js";

type AgentModel = MastraModelConfig;

export interface ApiRuntimeOptions {
  /** Override the model (tests pass a mock). Otherwise OPENAG_<BOTID>_MODEL, then the bot's stored model. */
  model?: AgentModel;
  capabilities?: (model: string) => ModelCapabilities | undefined;
  maxSteps?: number;
  retry?:RetryOptions;
  /** Tool definitions to expose; disabled ones (enabled() false) are left out. Defaults to defaultToolDefs. */
  tools?: ToolDef[];
  /** Extra definitions read at each turn (MCP servers), added to `tools`. */
  toolDefs?: () => ToolDef[];
  /** Runs bots whose model is `ollama/<name>` (local chat models). */
  ollama?: BotRuntime;
}

/** Mastra adapters for enabled tools. Execution and approval stay behind ctx.callTool. */
export function buildMastraTools(ctx: Pick<TurnContext, "callTool"|"state"|"saveState">, defs: ToolDef[]) {
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const def of enabledTools(defs)) {
    tools[def.name] = createTool({
      id: def.name,
      description: def.description,
      inputSchema: def.input,
      execute: async (input) => modelToolResult(ctx, await ctx.callTool(def.name, input)),
    });
  }
  return tools;
}

function resolveModel(ctx: TurnContext, override?: AgentModel): AgentModel {
  if (override) return override;
  const fromEnv = modelOverride(ctx.bot);
  if (fromEnv === INVALID_MODEL_OVERRIDE) throw new Error(INVALID_MODEL_OVERRIDE);
  const id = fromEnv ?? ctx.bot.model;
  if (!id) {
    throw new Error(`no model configured for bot ${ctx.bot.id}; set OPENAG_${ctx.bot.id.toUpperCase()}_MODEL (e.g. openai/gpt-4o-mini)`);
  }
  return id as AgentModel;
}

export function createApiRuntime(opts: ApiRuntimeOptions = {}): BotRuntime {
  return {
    async runTurn(ctx) {
      if (!opts.model && modelOverride(ctx.bot) === INVALID_MODEL_OVERRIDE) throw new Error(INVALID_MODEL_OVERRIDE);
      // A bot on a local Ollama model never goes through Mastra or a hosted provider.
      if (opts.ollama && isOllamaBot(ctx.bot.id, ctx.bot.model)) return opts.ollama.runTurn(ctx);
      const model = resolveModel(ctx, opts.model);
      const requestModelName=typeof model==='string'?model:typeof model==='object'&&model!==null&&'modelId' in model&&typeof model.modelId==='string'?model.modelId:ctx.bot.model??'configured-model';
      ctx.signal?.throwIfAborted();
      const defs=enabledTools([...(opts.tools??defaultToolDefs),...(opts.toolDefs?.()??[])]).filter(def=>ctx.investigation?def.name==='investigation_read':def.name!=='investigation_read');
      const capabilities=opts.capabilities?.(typeof model==='string'?model:ctx.bot.model??'');
      const images=(ctx.attachments??[]).filter(file=>file.data&&apiImageInput(capabilities,file.mimeType));
      const attachmentInput=attachmentText(ctx.attachments,true,file=>images.includes(file)),schemas=defs.map(d=>({name:d.name,description:d.description,parameters:toolSchema(d,true)}));
      prepareTurnInput(ctx,attachmentInput,schemas,ctx.hostedInput,requestModelName);
      const recall=await ctx.loadHostedRecall?.()??[];
      ctx.signal?.throwIfAborted();
      const prepared=prepareTurnInput(ctx,attachmentInput,schemas,{...ctx.hostedInput!,data:[...ctx.hostedInput!.data,...recall]},requestModelName);
      const prompt=prepared.messages.map((message,index)=>index===prepared.messages.length-1&&images.length?
        {role:'user' as const,content:[{type:'text' as const,text:message.content},...images.map(file=>({type:'image' as const,image:`data:${file.mimeType};base64,${file.data}`,mimeType:file.mimeType}))]}:message.role==='assistant'?{role:'assistant' as const,content:message.content}:{role:'user' as const,content:message.content});
      const resolved=await resolveModelConfig(model);
      if(resolved.specificationVersion==='v1')throw Error('Hosted request retries require a supported model interface');
      const requestModel=new Proxy(resolved,{get(target,key){
        const value=Reflect.get(target,key,target);
        if((key==='doGenerate'||key==='doStream')&&typeof value==='function')return (params:Record<string,unknown>)=>{
          const parent=params.abortSignal instanceof AbortSignal?params.abortSignal:undefined;parent?.throwIfAborted();
          const trace=prepareRequest(ctx,{boundary:'sdk-request',model:requestModelName,messages:Array.isArray(params.prompt)?params.prompt:[],tools:Array.isArray(params.tools)?params.tools:[],settings:params,context:prepared.projection,attachments:requestAttachments(ctx.attachments,file=>images.includes(file))});
          return retryModelRequest(ctx,async signal=>Reflect.apply(value,target,[{...params,abortSignal:parent?AbortSignal.any([signal,parent]):signal}]),opts.retry,trace);
        };
        return typeof value==='function'?value.bind(target):value;
      }});
      const agent = new Agent({id:ctx.bot.id,name:ctx.bot.name,instructions:prepared.instructions,model:requestModel,maxRetries:0,errorProcessorDefaults:false,maxProcessorRetries:0,tools:buildMastraTools(ctx,defs)});
      const configuration = modelConfig(ctx.bot), budget = configuration.reasoning?.budget_tokens;
      if (modelTarget(ctx.bot) === "anthropic" && typeof budget === "number" && (!Number.isSafeInteger(configuration.outputLimit) || configuration.outputLimit! <= budget)) throw new Error("Saved thinking budget has no safe model output limit. Refresh model choices before retrying.");
      // The installed Anthropic transport adds its thinking budget to maxOutputTokens.
      const maxOutputTokens = typeof budget === "number" && configuration.outputLimit !== undefined ? configuration.outputLimit - (modelTarget(ctx.bot) === "anthropic" ? budget : 0) : undefined;
      const limit=hostedLimits(ctx,opts.maxSteps).maxSteps;
      if(Number(ctx.state.hostedSteps??0)>=limit)return {outcome:'incomplete' as const,reason:'step_limit' as const};
      let partial='',streamPartial='';
      let result;
      try { result = await agent.generate(prompt, { modelSettings: { maxRetries:0,...reasoningSettings(modelTarget(ctx.bot) ?? "", configuration.reasoning ?? {}, typeof model === "string" ? model : ctx.bot.model ?? ""), ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}) }, maxSteps: limit-Number(ctx.state.hostedSteps??0), prepareStep:()=>{beginModelStep(ctx,limit);},onStepFinish:step=>{if(step.text){partial=step.text;streamPartial='';}},onChunk:chunk=>{if(chunk.type==='text-delta')streamPartial=(streamPartial+chunk.payload.text).slice(0,100000);}, abortSignal: ctx.signal, providerOptions: providerOptions(ctx.bot) as AgentExecutionOptionsBase<unknown>["providerOptions"] });
      } catch(error) {
        ctx.signal?.throwIfAborted();
        const stopped=requestOutcome(ctx);if(stopped){if(streamPartial||partial)ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:streamPartial||partial});return stopped;}
        if(ctx.state.hostedStop){if(partial)ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:partial});return {outcome:'incomplete' as const,reason:ctx.state.hostedStop as import('./hosted-execution.js').StopReason};}
        throw new Error('Hosted model request failed. Check model configuration and provider availability.');
      }
      ctx.signal?.throwIfAborted();
      const steps = await result.steps;
      for (const step of steps) {
        const warnings = (step.warnings ?? []).map(warning => warning.type === "unsupported-setting" ? `Unsupported model setting: ${String(warning.setting).slice(0, 100)}` : "The provider reported a model configuration warning.").slice(0, 10);
        const metadata = step.providerMetadata?.openrouter;
        const provider = typeof metadata?.provider === "string" ? metadata.provider.slice(0, 100) : undefined;
        if (typeof step.response?.modelId === "string" || warnings.length) recordModel(ctx, { model: step.response?.modelId, source: "response", provider, warnings });
      }
      ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: result.text||streamPartial });
      const last=steps.at(-1);
      const unresolved=!!last?.toolCalls?.some(call=>!last.toolResults?.some(result=>result.payload.toolCallId===call.payload.toolCallId));
      if(requestOutcome(ctx))return requestOutcome(ctx);
      return hostedOutcome(ctx,await result.finishReason,unresolved,Number(ctx.state.hostedSteps??0)>=limit);
    },
  };
}
