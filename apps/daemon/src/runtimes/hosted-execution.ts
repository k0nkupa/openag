import type { TurnContext, ToolOutcome } from './types.js';

export type StopReason = 'step_limit'|'tool_limit'|'context_limit'|'output_truncated'|'unresolved_calls'|'unknown_stop'|'provider_backoff'|'deadline'|'provider_interrupted'|'provider_error';
export type RuntimeOutcome = { outcome:'completed'|'incomplete'|'failed'|'cancelled'; reason?:StopReason; nextAttemptAt?:number; message?:string };
export class HostedStop extends Error { constructor(public reason:StopReason){super(reason);} }
export function hostedLimits(ctx:TurnContext, override?:number) {
  const saved=ctx.state.hostedLimits as {maxSteps:number;maxTools:number}|undefined;
  if(saved)return saved;
  const configured=(ctx.bot.config as {maxSteps?:number})?.maxSteps;
  const maxSteps=ctx.investigation?12:override??configured??20;
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>100)throw Error('Invalid hosted model-step limit');
  const limits={maxSteps,maxTools:ctx.investigation?24:40};Object.assign(ctx.state,{hostedLimits:limits});ctx.saveState({hostedLimits:limits});return limits;
}
export function stopHosted(ctx:Pick<TurnContext,'state'|'saveState'>, reason:StopReason) { if(!ctx.state.hostedStop){ctx.state.hostedStop=reason;ctx.saveState({hostedStop:reason});} }
export function beginModelStep(ctx:TurnContext, limit:number) {
  if(ctx.state.hostedStop)throw new HostedStop(ctx.state.hostedStop as StopReason);
  const count=Number(ctx.state.hostedSteps??0);
  if(count>=limit){stopHosted(ctx,'step_limit');throw new HostedStop('step_limit');}
  ctx.state.hostedSteps=count+1;ctx.saveState({hostedSteps:count+1});
}
/** Bound the projection, not the retained tool/receipt evidence. Never slice serialized JSON. */
export function modelToolResult(ctx:Pick<TurnContext,'state'|'saveState'>, outcome:ToolOutcome):ToolOutcome {
  const text=JSON.stringify(outcome);
  const nested=outcome.result&&typeof outcome.result==='object'&&(outcome.result as {truncated?:unknown}).truncated===true;
  if(text.length<=20_000&&!nested)return outcome;
  stopHosted(ctx,'output_truncated');
  if(text.length<=20_000)return outcome;
  if(!outcome.ok){
    const {result: evidence,...status}=outcome;
    return {...status,message:outcome.message.slice(0,2000),...(evidence===undefined?{}:{result:{untrusted:true,truncated:true,excerpt:JSON.stringify(evidence).slice(0,8000)}}),truncated:true,originalCharacters:text.length};
  }
  const value=outcome.result as Record<string,unknown>|null;
  const metadata=value&&typeof value==='object'?Object.fromEntries(['untrusted','notice','app','server'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,typeof value[k]==='string'?(value[k] as string).slice(0,300):k==='untrusted'?value[k]===true:undefined])):{};
  let excerpt=text.slice(0,8000);
  let result:ToolOutcome={...outcome,result:{...metadata,truncated:true,originalCharacters:text.length,excerpt}};
  while(JSON.stringify(result).length>20_000){excerpt=excerpt.slice(0,Math.floor(excerpt.length/2));result={...outcome,result:{...metadata,truncated:true,originalCharacters:text.length,excerpt}};}
  return result;
}
export function hostedOutcome(ctx:TurnContext, finish:string|undefined, unresolved:boolean, atLimit:boolean):RuntimeOutcome {
  const reason=ctx.state.hostedStop as StopReason|undefined;
  if(reason)return {outcome:'incomplete',reason};
  if(finish==='length')return {outcome:'incomplete',reason:'output_truncated'};
  if(unresolved||finish==='tool-calls'||finish==='tool_calls'||finish==='tool-use')return {outcome:'incomplete',reason:atLimit?'step_limit':'unresolved_calls'};
  if(finish==='stop'||finish==='end_turn')return {outcome:'completed'};
  if(finish==='error')return {outcome:'failed'};
  return {outcome:'incomplete',reason:'unknown_stop'};
}
