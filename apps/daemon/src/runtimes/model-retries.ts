import type { RequestTrace } from '../request-provenance.js';
import { modelRevision } from '../botmodels.js';
import { HostedStop, stopHosted, type RuntimeOutcome, type StopReason } from './hosted-execution.js';
import type { TurnContext } from './types.js';

export interface ProviderWait { revision:string; notBeforeAt:number|null }
interface RequestState { step:number; revision:string; attempts:number; deadlineAt:number; status:'active'|'completed'|'stopped' }
export interface RetryOptions {
  windowMs?:number;
  now?:()=>number;
  elapsed?:()=>number;
  wait?:(ms:number,signal:AbortSignal)=>Promise<void>;
}
export class ModelHttpError extends Error {
  constructor(public statusCode:number,public responseHeaders:Record<string,string>,message='Model HTTP request failed'){super(message);}
}
class RequestFailure extends HostedStop {}
export function requestOutcome(ctx:TurnContext):RuntimeOutcome|undefined { return ctx.state.modelRequestOutcome as RuntimeOutcome|undefined; }
function save(ctx:TurnContext,patch:Record<string,unknown>){Object.assign(ctx.state,patch);ctx.saveState(patch);}
function fail(ctx:TurnContext,reason:StopReason,outcome:'incomplete'|'failed',nextAttemptAt?:number,message?:string):never {
  stopHosted(ctx,reason);save(ctx,{modelRequestOutcome:{outcome,reason,...(nextAttemptAt!==undefined?{nextAttemptAt}:{}),...(message?{message:message.slice(0,200)}:{})}});
  throw new RequestFailure(reason);
}
function cancelled(signal:AbortSignal){if(signal.aborted)throw signal.reason??new Error('Model request cancelled');}
function abortable<T>(operation:PromiseLike<T>,signal:AbortSignal):Promise<T>{
  const pending=Promise.resolve(operation);
  if(signal.aborted){void pending.catch(()=>{});cancelled(signal);}
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new Error('Model request cancelled'));};
    signal.addEventListener('abort',abort,{once:true});
    pending.then(value=>{if(signal.aborted&&value&&typeof value==='object'&&'stream' in value&&value.stream instanceof ReadableStream)void value.stream.cancel().catch(()=>{});resolve(value);},reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
function wait(ms:number,signal:AbortSignal):Promise<void>{
  cancelled(signal);
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason??new Error('Model request cancelled'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
function semanticFailure(error:unknown):'context_limit'|'provider_error'|undefined {
  if(!error||typeof error!=='object')return;
  const e=error as {data?:{error?:unknown};cause?:unknown};
  const context=new Set(['context_length_exceeded','context_window_exceeded','max_context_length_exceeded','context_overflow','input_too_long','prompt_too_long']);
  const terminal=new Set(['authentication_error','authorization_error','permission_denied','invalid_api_key','invalid_request_error','invalid_argument','model_not_found','unsupported_model','invalid_model','invalid_model_configuration','bad_request','config_error','insufficient_quota','billing_hard_limit_reached','content_policy_violation','ai_loadapikeyerror','loadapikeyerror','model_router_no_gateway_found','mastra_gateway_no_api_key','netlify_gateway_no_token','netlify_gateway_no_site_id','azure_entra_id_auth_not_configured']);
  for(const candidate of [error,e.data,e.data?.error,e.cause]){
    if(!candidate||typeof candidate!=='object')continue;
    for(const value of [(candidate as {code?:unknown}).code,(candidate as {type?:unknown}).type,(candidate as {id?:unknown}).id,(candidate as {name?:unknown}).name]){
      if(typeof value!=='string')continue;
      const code=value.toLowerCase();if(context.has(code))return 'context_limit';if(terminal.has(code))return 'provider_error';
    }
  }
}
function temporary(error:unknown):boolean {
  if(!error||typeof error!=='object'||semanticFailure(error))return false;
  const e=error as {name?:unknown;isRetryable?:unknown;statusCode?:unknown;code?:unknown;cause?:{code?:unknown}};
  if(e.name==='AbortError'||e.name==='TimeoutError'||e.isRetryable===false)return false;
  if(typeof e.statusCode==='number')return [429,500,502,503,504].includes(e.statusCode);
  return ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN'].includes(String(e.code??e.cause?.code??''));
}
function providerTime(error:unknown,now:number):number|undefined {
  const headers=(error as {responseHeaders?:unknown})?.responseHeaders;
  const get=(key:string):string|undefined=>headers instanceof Headers?headers.get(key)??undefined:headers&&typeof headers==='object'?Object.entries(headers).find(([k])=>k.toLowerCase()===key)?.[1] as string|undefined:undefined;
  const times:number[]=[];
  for(const [name,multiplier]of [['retry-after',1000],['retry-after-ms',1]] as const){
    const raw=get(name);if(typeof raw!=='string')continue;
    const value=raw.trim();
    if(/^\d+$/.test(value)){const at=now+Number(value)*multiplier;times.push(Number.isSafeInteger(at)&&at<=8.64e15?at:Infinity);}
    else if(name==='retry-after'&&/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)){
      const at=Date.parse(value);if(Number.isFinite(at))times.push(at);
    }
  }
  return times.length?Math.max(now,...times):undefined;
}
/** One owner for one generation request. Returned streams are never retried after delivery. */
export async function retryModelRequest<T>(ctx:TurnContext,operation:(signal:AbortSignal)=>PromiseLike<T>,options:RetryOptions={},trace?:RequestTrace):Promise<T>{
  const now=options.now??Date.now,elapsed=options.elapsed??(()=>performance.now()),sleep=options.wait??wait;
  const windowMs=options.windowMs??300_000,revision=modelRevision(ctx.bot),step=Number(ctx.state.hostedSteps??0);
  if(!Number.isFinite(windowMs)||windowMs<=0)throw Error('Invalid model-request window');
  ctx.signal?.throwIfAborted();
  if(ctx.state.hostedStop)throw new HostedStop(ctx.state.hostedStop as StopReason);
  const previous=ctx.state.hostedRequest as RequestState|undefined;
  const request:RequestState=previous?.step===step&&previous.revision===revision?{...previous}:{step,revision,attempts:0,deadlineAt:now()+windowMs,status:'active'};
  const remaining=Math.min(windowMs,request.deadlineAt-now()),end=elapsed()+remaining;
  const controller=new AbortController(),signal=ctx.signal?AbortSignal.any([ctx.signal,controller.signal]):controller.signal;
  const timer=setTimeout(()=>controller.abort(new Error('Model request deadline')),Math.max(0,remaining));timer.unref?.();
  const cleanup=()=>clearTimeout(timer);
  const persist=()=>save(ctx,{hostedRequest:{...request}});
  const stop=(reason:StopReason,outcome:'incomplete'|'failed',at?:number,message?:string):never=>{request.status='stopped';persist();return fail(ctx,reason,outcome,at,message);};
  const check=()=>{ctx.signal?.throwIfAborted();if(controller.signal.aborted||elapsed()>=end)stop('deadline','incomplete');if(ctx.state.hostedStop)throw new HostedStop(ctx.state.hostedStop as StopReason);};
  let streaming=false;
  try{
    persist();
    const pending=ctx.state.providerWait as ProviderWait|undefined;
    if(pending?.revision===revision&&(pending.notBeforeAt===null||pending.notBeforeAt>now())){
      const at=pending.notBeforeAt??undefined;
      if(at===undefined)return stop('provider_backoff','incomplete');
      if(at-now()>=end-elapsed())stop('provider_backoff','incomplete',at);
      await abortable(sleep(at-now(),signal),signal);check();
    }
    check();
    while(request.attempts<3){
      check();request.attempts++;persist();
      trace?.start(request.attempts);
      try{
        const result=await abortable(operation(signal),signal);check();
        if(result&&typeof result==='object'&&'stream' in result&&result.stream instanceof ReadableStream){
          const reader=result.stream.getReader();streaming=true;let contentDelivered=false;
          let settled=false;const observed:Record<string,unknown>={};
          const settle=(status:'returned'|'interrupted'|'cancelled')=>{if(!settled){settled=true;trace?.settle(request.attempts,status,observed);}};
          const streamFailed=(error:unknown):never=>{
            const semantic=semanticFailure(error);
            if(semantic==='context_limit')stop('context_limit','incomplete');
            if(semantic==='provider_error'||(!contentDelivered&&!temporary(error)))stop('provider_error','failed');
            return stop('provider_interrupted','incomplete');
          };
          const stream=new ReadableStream({
            async pull(output){
              try{check();const item=await abortable(reader.read(),signal);check();if(item.done){request.status='completed';persist();settle('returned');cleanup();output.close();}else{if(item.value&&typeof item.value==='object'){if(item.value.type==='response-metadata')observed.response={modelId:item.value.modelId};if(item.value.type==='finish')observed.usage=item.value.usage;if(item.value.type==='error')streamFailed(item.value.error);if(['text-delta','reasoning-delta','tool-call','tool-input-start','tool-input-delta','file'].includes(item.value.type))contentDelivered=true;}output.enqueue(item.value);}}
              catch(error){settle(ctx.signal?.aborted?'cancelled':'interrupted');cleanup();void reader.cancel().catch(()=>{});if(ctx.signal?.aborted||error instanceof HostedStop){output.error(error);return;}
                try{if(controller.signal.aborted||elapsed()>=end)stop('deadline','incomplete');streamFailed(error);}catch(stopped){output.error(stopped);}}
            },
            async cancel(reason){settle('cancelled');cleanup();await reader.cancel(reason).catch(()=>{});},
          },{highWaterMark:0});
          // SDK transport metadata includes non-enumerable symbols; spreading drops it.
          return Object.create(Object.getPrototypeOf(result),{...Object.getOwnPropertyDescriptors(result),stream:{value:stream,enumerable:true,writable:true,configurable:true}});
        }
        request.status='completed';persist();trace?.settle(request.attempts,'returned',result);return result;
      }catch(error){
        trace?.settle(request.attempts,ctx.signal?.aborted?'cancelled':'failed');
        check();
        if(error instanceof HostedStop)throw error;
        if(semanticFailure(error)==='context_limit')stop('context_limit','incomplete');
        if(!temporary(error))stop('provider_error','failed',undefined,error instanceof ModelHttpError?error.message:undefined);
        const providerAt=providerTime(error,now());
        if(request.attempts>=3){
          if(providerAt!==undefined&&providerAt>now()){save(ctx,{providerWait:{revision,notBeforeAt:Number.isFinite(providerAt)?providerAt:null}});stop('provider_backoff','incomplete',Number.isFinite(providerAt)?providerAt:undefined);}
          stop('provider_error','failed');
        }
        const at=Math.max(now()+1000*2**(request.attempts-1),providerAt??0);
        save(ctx,{hostedRequest:{...request},providerWait:{revision,notBeforeAt:Number.isFinite(at)?at:null}});
        if(!Number.isFinite(at)||at-now()>=end-elapsed())stop('provider_backoff','incomplete',Number.isFinite(at)?at:undefined);
        await abortable(sleep(at-now(),signal),signal);check();
      }
    }
    return stop('provider_error','failed');
  }catch(error){ctx.signal?.throwIfAborted();if(controller.signal.aborted||elapsed()>=end)stop('deadline','incomplete');throw error;}
  finally{if(!streaming)cleanup();}
}
