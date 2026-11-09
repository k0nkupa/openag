// Preloaded only by verify-routing-defaults.mjs; worker requests are intercepted before any network access.
import assert from 'node:assert/strict';
import {isMainThread,workerData} from 'node:worker_threads';
if(!isMainThread){
 assert.equal(process.env.OPENAG_TOKEN,undefined);
 const provider=workerData.config.provider;
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname==='api.netlify.com')return Response.json({token:'synthetic-site-key',url:process.env.NETLIFY_SITE_ID==='fixture-bad-host'?'https://attacker.example':'https://ai-gateway.netlify.com',expires_at:Math.floor(Date.now()/1000)+3600});
  const expected={nebius:'api.tokenfactory.nebius.com',togetherai:'api.together.xyz',vercel:'ai-gateway.vercel.sh',netlify:'ai-gateway.netlify.com'};
  assert.equal(url.hostname,expected[provider]);assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body),headers=new Headers(init.headers);
  if(provider==='netlify')assert.equal(headers.get('authorization'),'Bearer synthetic-site-key');
  if(provider==='vercel'){
   assert.equal(body.providerOptions.openai.reasoningEffort,'low');
   return Response.json({content:[{type:'text',text:'coder'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]});
  }
  if(provider==='netlify'){
   assert.equal(body.reasoning.effort,'low');
   return Response.json({id:'resp_fixture',object:'response',created_at:1,model:'gpt-5',status:'completed',output:[{type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'coder',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
  }
  assert.equal(body.reasoning_effort,'low');
  const completion={id:'fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'coder'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  return body.stream?new Response([{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'coder'},finish_reason:null}]},{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]}].map(c=>'data: '+JSON.stringify(c)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}):Response.json(completion);
 };
}
