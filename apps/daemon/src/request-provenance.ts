import { modelConfig } from './botmodels.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from './db/index.js';
import type { LedgerEvent } from './ledger.js';
import { getDefaultRedactor } from './redact.js';
import type { PromptAttachment } from './uploads.js';
import type { TurnContext } from './runtimes/types.js';

export interface ContextDescriptor {
  source:string; sourceIndex?:number; reference?:number; characters:number; selectedCharacters:number;
  fingerprint:string; reason?:string;
}
export interface ContextProjection {
  sources:ContextDescriptor[]; historyOmitted:number; historyOmittedRange?:{firstEligibleId:number;throughExclusive:number}; historyBoundary?:number;
  measurement:'javascript-string-length'; limit:number|null; requiredCharacters:number;
  upstreamLoss:'unavailable';
}
export interface RequestManifest {
  version:1; manifestId:string; turnId:string; step:number; boundary:'ollama-payload'|'sdk-request'|'acp-handoff'|'admission';
  toolObservation:'observed-schema'|'daemon-allowlist-names'; admissionRefusal?:'context_limit'|'context_invalid';
  requestedModel:string; requestedSettings:Record<string,string|number|boolean>; settings:Record<string,string|number|boolean>; fingerprint:string;
  messages:Array<{role:string;characters:number;fingerprint:string;parts:number;binaryParts:number;toolReferenceOverflow:number;toolReferences:Array<{name:string;callId?:string;source?:{kind:'skill'|'help';identity:string;version:string|number|null;path?:string;fingerprint?:string}}>}>;
  fingerprintCoverage:'redacted-text-tools-and-allowlisted-settings';
  messageOverflow:number; tools:Array<{name:string;fingerprint:string}>; toolCount:number; toolOverflow:number; toolFingerprint:string;
  context?:ContextProjection; sourceOverflow:number;
  attachments:Array<{id:string;representation:'text'|'image'|'reference'|'omitted';characters?:number;reason?:string}>;
  permission?:{id:string;revision:number;parents:Array<{id:string;revision:number}>}; restrictions:{isolated:boolean;unattended:boolean;noNetwork:boolean;allowApprovals:boolean;noIndex:boolean;investigation:boolean};
  session?:{idFingerprint:string;context:'fresh'|'reused';childRequests:'unavailable';adapter?:string;reportedModel?:string|null};
}
export interface RequestRecord { id:number; ts:number; manifest:RequestManifest; evidence:Array<Record<string,unknown>>; turnStatus:string }
export interface RequestPage { records:RequestRecord[]; nextCursor:number|null; receipts:Array<{id:string;toolName:string}> }
const MAX_MANIFEST=16*1024;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=(v:unknown,max=100)=>{const text=getDefaultRedactor().redactString(String(v??'')).replace(/(?:https?:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\)\S*/g,'[private reference]');return text.length>max?text.slice(0,max-1)+'…':text;};
/** Fingerprints cover redacted text/schema metadata, never binary content or transport credentials. */
export function requestFingerprint(value:unknown):string {
  const safe=getDefaultRedactor().redact(value);
  const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':isRecord(v)?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)??'null';
  return createHash('sha256').update(canonical(safe)).digest('hex');
}
export function contextDescriptor(source:string,content:string,selected:string,reference?:number,reason?:string):ContextDescriptor {
  return {source:label(source),...(reference!==undefined?{reference}:{}),characters:content.length,selectedCharacters:selected.length,fingerprint:requestFingerprint(selected),...(reason?{reason}:{})};
}
/** Only first-party source metadata from the observed result; never parse clipped excerpts as complete sources. */
function toolSource(name:unknown,output:unknown):RequestManifest['messages'][number]['toolReferences'][number]['source'] {
  if(name!=='skill_load'&&name!=='openag_help')return;
  let value=output;
  if(isRecord(value)&&value.type==='json')value=value.value;
  else if(isRecord(value)&&value.type==='text')value=value.value;
  if(typeof value==='string'&&value.length<=20000){try{value=JSON.parse(value);}catch{return;}}
  if(!isRecord(value)||!isRecord(value.result)||value.truncated===true||value.result.truncated===true)return;
  const result=value.result;
  if(result.found!==true)return;
  const source=name==='openag_help'?result:isRecord(result.skill)?result.skill:isRecord(result.resource)?result.resource:undefined;
  if(!source)return;
  const version=typeof source.version==='number'&&Number.isSafeInteger(source.version)?source.version:typeof source.version==='string'?label(source.version):null;
  const content=typeof source.body==='string'?source.body:typeof source.text==='string'?source.text:undefined;
  return {kind:name==='openag_help'?'help':'skill',identity:label(source.id??source.slug??'unavailable',512),version,...(typeof source.path==='string'?{path:label(source.path,256)}:{}),...(content!==undefined?{fingerprint:requestFingerprint(content)}:{})};
}
function messageDescriptor(value:unknown):RequestManifest['messages'][number] {
  const message=isRecord(value)?value:{};
  const parts=Array.isArray(message.content)?message.content:Array.isArray(message.prompt)?message.prompt:[message];
  let binaryParts=Array.isArray(message.images)?message.images.length:0,characters=0;
  const toolReferences:RequestManifest['messages'][number]['toolReferences']=[];
  const visible:unknown[]=parts.map(part=>{
    if(!isRecord(part))return null;
    if(part.type==='image'||part.type==='file'){binaryParts++;return {type:part.type,mimeType:label(part.mimeType)};}
    const text=typeof part.text==='string'?part.text:typeof part.content==='string'?part.content:isRecord(part.resource)&&typeof part.resource.text==='string'?part.resource.text:undefined;
    if(text!==undefined){characters+=text.length;return {type:part.type??'text',text};}
    // Count the model-content representation, excluding provider framing and binary blocks.
    if(part.type==='tool-call')characters+=(JSON.stringify(part.input)??'').length;
    if(part.type==='tool-result'&&isRecord(part.output)){
      const output=part.output;
      if(['text','error-text'].includes(String(output.type))&&typeof output.value==='string')characters+=output.value.length;
      else if(['json','error-json'].includes(String(output.type)))characters+=(JSON.stringify(output.value)??'').length;
      else if(output.type==='execution-denied'&&typeof output.reason==='string')characters+=output.reason.length;
      else if(output.type==='content'&&Array.isArray(output.value))for(const item of output.value)if(isRecord(item)&&item.type==='text'&&typeof item.text==='string')characters+=item.text.length;
    }
    // Structured tool calls/results are data; retain only their fingerprint, not their body.
    if(['tool-call','tool-result','tool-approval-response'].includes(String(part.type))||message.role==='tool'){toolReferences.push({name:label(part.toolName??message.tool_name??'unavailable',512),source:toolSource(part.toolName,part.output),...(typeof part.toolCallId==='string'?{callId:label(part.toolCallId)}:{})});return {type:part.type,fingerprint:requestFingerprint(part)};}
    return null;
  });
  if(Array.isArray(message.tool_calls)){for(const call of message.tool_calls)if(isRecord(call)&&isRecord(call.function)){characters+=(JSON.stringify(call.function.arguments)??'').length;toolReferences.push({name:label(call.function.name,512)});}visible.push({type:'tool-calls',fingerprint:requestFingerprint(message.tool_calls)});}
  if(typeof message.tool_name==='string')toolReferences.push({name:label(message.tool_name,512),source:toolSource(message.tool_name,message.content)});
  return {role:label(message.role??'handoff',30),characters,fingerprint:requestFingerprint(visible),parts:parts.length,binaryParts,toolReferenceOverflow:Math.max(0,toolReferences.length-64),toolReferences:toolReferences.slice(0,64)};
}
export function requestSettings(input:unknown):RequestManifest['settings'] {
  const out:RequestManifest['settings']={};if(!isRecord(input))return out;
  for(const key of ['temperature','topP','topK','maxOutputTokens','maxTokens','seed','frequencyPenalty','presencePenalty','think','effort','reasoning_effort','reasoningEffort','toggle','thinking','budget_tokens','outputLimit']){
    const value=input[key];if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')out[key]=value as number|boolean;
    else if(typeof value==='string')out[key]=label(value,60);
  }
  const nested=isRecord(input.providerOptions)?input.providerOptions:{};
  const paths=['reasoningEffort','effort','enableThinking','thinkingBudget','thinking.type','thinking.budgetTokens','thinkingConfig.thinkingLevel','thinkingConfig.thinkingBudget','reasoning.effort','reasoning.max_tokens','reasoning.enabled'];
  for(const [provider,options] of Object.entries(nested).slice(0,16)){
    if(!/^[a-z][a-z0-9-]{0,40}$/.test(provider)||!isRecord(options))continue;
    for(const path of paths){
      let value:unknown=options;
      for(const key of path.split('.'))value=isRecord(value)&&Object.hasOwn(value,key)?value[key]:undefined;
      if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))out[provider+'.'+path]=value;
      else if(typeof value==='string')out[provider+'.'+path]=label(value,60);
    }
  }
  return out;
}
export function requestAttachments(files:readonly PromptAttachment[]=[],images:boolean|((file:PromptAttachment)=>boolean)=false,included=true):RequestManifest['attachments'] {
  return files.map(file=>{const image=!!file.data&&(typeof images==='function'?images(file):images);return {id:label(file.id),representation:!included?'omitted':file.text!==undefined?'text':image?'image':'reference',...(included&&file.text!==undefined?{characters:file.text.length}:{}),...(!included?{reason:'not-in-follow-up'}:file.text===undefined&&!image?{reason:'image-unavailable'}:{})};});
}
export function prepareRequest(ctx:TurnContext,input:{boundary:RequestManifest['boundary'];model:string;messages:unknown[];tools?:unknown[];settings?:unknown;context?:ContextProjection;session?:RequestManifest['session'];toolObservation?:RequestManifest['toolObservation'];admissionRefusal?:RequestManifest['admissionRefusal'];attachments?:RequestManifest['attachments']}):RequestTrace {
  const allMessages=input.messages.map(messageDescriptor),tools=(input.tools??[]).map(item=>{
    const t=isRecord(item)?item:{},f=isRecord(t.function)?t.function:t;
    return {name:label(f.name,512),fingerprint:requestFingerprint(f)};
  });
  let permission:RequestManifest['permission'];
  try{const p=JSON.parse(String(ctx.state.permissionContext));if(typeof p.id==='string'&&Number.isSafeInteger(p.revision))permission={id:label(p.id),revision:p.revision,parents:Array.isArray(p.parents)?p.parents.slice(0,8).filter((ref:unknown)=>isRecord(ref)&&typeof ref.id==='string'&&Number.isSafeInteger(ref.revision)).map((ref:{id:string;revision:number})=>({id:label(ref.id),revision:ref.revision})):[]};}catch{}
  const context=input.context?{...input.context,sources:input.context.sources.slice(0,64)}:undefined;
  const session=input.session?{...input.session,adapter:label(input.session.adapter,40),reportedModel:input.session.reportedModel?label(input.session.reportedModel,200):null}:undefined;
  const manifest:RequestManifest={
    version:1,manifestId:randomUUID(),turnId:ctx.turnId,
    toolObservation:input.toolObservation??'observed-schema',admissionRefusal:input.admissionRefusal,
    step:input.boundary==='acp-handoff'?Number(ctx.state.provenanceHandoffs??0)+1:Number(ctx.state.hostedSteps??0),
    boundary:input.boundary,requestedModel:label(input.model,200),
    requestedSettings:requestSettings({...modelConfig(ctx.bot).reasoning,outputLimit:modelConfig(ctx.bot).outputLimit}),
    settings:requestSettings(input.settings),
    fingerprint:requestFingerprint({model:input.model,adapter:input.session?.adapter,sessionModel:input.session?.reportedModel,messages:allMessages,tools,settings:requestSettings(input.settings)}),
    fingerprintCoverage:'redacted-text-tools-and-allowlisted-settings',
    messages:allMessages.slice(0,64),messageOverflow:Math.max(0,allMessages.length-64),
    tools:tools.slice(0,64),toolCount:tools.length,toolOverflow:Math.max(0,tools.length-64),toolFingerprint:requestFingerprint(tools),
    context,sourceOverflow:Math.max(0,(input.context?.sources.length??0)-64),
    attachments:input.attachments??[],permission,
    restrictions:{isolated:ctx.state.isolated===true,unattended:ctx.state.unattended===true,noNetwork:ctx.state.noNetwork===true,allowApprovals:ctx.state.allowApprovals===true,noIndex:ctx.state.noIndex===true,investigation:!!ctx.investigation},
    session,
  };
  // Trim descriptors, preserving explicit overflow counts and whole-catalogue/request fingerprints.
  while(Buffer.byteLength(JSON.stringify(manifest))>MAX_MANIFEST){
    if(manifest.context?.sources.length){manifest.context.sources.pop();manifest.sourceOverflow++;}
    else if(manifest.tools.length){manifest.tools.pop();manifest.toolOverflow++;}
    else if(manifest.messages.length){manifest.messages.pop();manifest.messageOverflow++;}
    else throw Error('Request evidence exceeds its storage limit.');
  }
  ctx.signal?.throwIfAborted();
  ctx.ledger.append(ctx.room.id,ctx.bot.id,'request_prepared',manifest);
  if(input.boundary==='acp-handoff')ctx.saveState({provenanceHandoffs:manifest.step});
  return new RequestTrace(ctx,manifest.manifestId);
}
export class RequestTrace {
  constructor(private ctx:TurnContext,readonly id:string){}
  start(attempt:number){this.ctx.signal?.throwIfAborted();this.ctx.ledger.append(this.ctx.room.id,this.ctx.bot.id,'request_attempt',{turnId:this.ctx.turnId,manifestId:this.id,attempt,status:'started'});}
  settle(attempt:number,status:'returned'|'failed'|'cancelled'|'interrupted',result?:unknown){
    try{
    const response=isRecord(result)?result:{},usage=isRecord(response.usage)?response.usage:{};
    const tokens:Record<string,number>={};
    for(const key of ['inputTokens','outputTokens','totalTokens','prompt_eval_count','eval_count']){
      const value=usage[key]??response[key],count=isRecord(value)?value.total:value;
      if(typeof count==='number'&&Number.isSafeInteger(count)&&count>=0)tokens[key]=count;
    }
    const metadata=isRecord(response.response)?response.response:response;
    const payload={turnId:this.ctx.turnId,manifestId:this.id,attempt,status,...(typeof metadata.modelId==='string'||typeof metadata.model==='string'?{reportedModel:label(metadata.modelId??metadata.model)}:{}),usage:Object.keys(tokens).length?{source:'provider-reported',unit:'tokens',...tokens}:null};
    // A settlement write failure must never retry an already-dispatched operation.
    this.ctx.ledger.append(this.ctx.room.id,this.ctx.bot.id,'request_attempt',payload);
    }catch{}
  }
}
/** All ordinary activity surfaces carry refresh references, even for Full devices. */
export function publicRequestEvent(event:LedgerEvent):LedgerEvent {
  if(!['request_prepared','request_attempt'].includes(event.type))return event;
  const p=isRecord(event.payload)?event.payload:{};
  return {...event,payload:{turnId:p.turnId,manifestId:p.manifestId}};
}
export function requestPage(db:Db,turnId:string,before?:number):RequestPage {
  const turn=db.prepare('SELECT status FROM turns WHERE id=?').get(turnId) as {status:string}|undefined;
  const rows=db.prepare("SELECT id,ts,payload_json FROM events WHERE type='request_prepared' AND json_extract(payload_json,'$.turnId')=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 21").all(turnId,before??null,before??null) as Array<{id:number;ts:number;payload_json:string}>;
  const records=rows.slice(0,20).map(row=>{
    const manifest=JSON.parse(row.payload_json) as RequestManifest;
    const evidence=(db.prepare("SELECT ts,payload_json FROM events WHERE type='request_attempt' AND json_extract(payload_json,'$.turnId')=? AND json_extract(payload_json,'$.manifestId')=? ORDER BY id LIMIT 8").all(turnId,manifest.manifestId) as Array<{ts:number;payload_json:string}>).map(e=>({ts:e.ts,...JSON.parse(e.payload_json)}));
    return {id:row.id,ts:row.ts,manifest,evidence,turnStatus:turn?.status??'unavailable'};
  });
  const receipts=(db.prepare('SELECT id,tool_name FROM action_receipts WHERE turn_id=? ORDER BY seq LIMIT 40').all(turnId) as Array<{id:string;tool_name:string}>).map(row=>({id:label(row.id),toolName:label(row.tool_name)}));
  const page:RequestPage={records,nextCursor:rows.length>20?rows[19]!.id:null,receipts};
  while(Buffer.byteLength(JSON.stringify(page))>512*1024&&page.records.length>1){page.records.pop();page.nextCursor=page.records.at(-1)!.id;}
  return page;
}
