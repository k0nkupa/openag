// Exercise the installed Mastra provider transports, with all network requests intercepted.
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','GOOGLE_API_KEY','GROQ_API_KEY','NEBIUS_API_KEY','XAI_API_KEY','DEEPSEEK_API_KEY','PERPLEXITY_API_KEY','DASHSCOPE_API_KEY','MISTRAL_API_KEY','CEREBRAS_API_KEY','DEEPINFRA_API_KEY'])process.env[key]='synthetic-transport-fixture';
process.env.MASTRA_OFFLINE='1';
const requests=[],events=[];
const responseModel='controlled-returned-model';
const response={id:'resp_fixture',object:'response',created_at:1,model:responseModel,status:'completed',output:[{type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'controlled',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
const sse=items=>new Response(items.map(item=>`data: ${JSON.stringify(item)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
globalThis.fetch=async(url,init={})=>{
 const address=String(url),body=init.body?JSON.parse(init.body):null;requests.push({url:address,body});
 assert.ok(/^https:\/\/(api\.openai\.com|api\.anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.groq\.com|api\.tokenfactory\.nebius\.com|api\.x\.ai|api\.deepseek\.com|api\.perplexity\.ai|dashscope-intl\.aliyuncs\.com|api\.mistral\.ai|api\.cerebras\.ai|api\.deepinfra\.com)\//.test(address),'Unexpected network request refused');
 if(address.includes('perplexity.ai'))return Response.json(response);
 if(address.includes('googleapis.com')){
  const google={candidates:[{index:0,content:{role:'model',parts:[{text:'controlled'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},modelVersion:responseModel};
  return body? (address.includes('streamGenerateContent') ? sse([google]) : Response.json(google)) : Response.json({});
 }
 if(address.includes('/responses')){
  if(!body.stream)return Response.json(response);
  const item=response.output[0];
  return sse([{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'controlled'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]);
 }
 if(address.includes('anthropic.com')){
  const message={id:'msg_fixture',type:'message',role:'assistant',model:responseModel,content:[{type:'text',text:'controlled'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};
  if(!body.stream)return Response.json(message);
  return sse([{type:'message_start',message:{...message,content:[],stop_reason:null}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'controlled'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'}]);
 }
 const completion={id:'chat_fixture',object:'chat.completion',created:1,model:responseModel,provider:'controlled-provider',choices:[{index:0,message:{role:'assistant',content:'controlled'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
 if(!body.stream)return Response.json(completion);
 return sse([{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'controlled'},finish_reason:null}]},{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]}]);
};
try{
 process.env.OPENAG_OVERRIDE_MODEL='openai/gpt-5';
 const {createApiRuntime}=await import('../apps/daemon/dist/runtimes/api.js');
 for(const [id,model,reasoning]of [['new-identity','openai/arbitrary-new-model',{}],['deepinfra','deepinfra/deepseek-ai/DeepSeek-V4-Pro',{effort:'low'}],['mistral','mistral/magistral-small-latest',{effort:'high'}],['cerebras','cerebras/gpt-oss-120b',{effort:'low'}],['perplexity','perplexity/sonar-pro',{effort:'low'}],['alibaba','alibaba/qwen3.8-flash',{effort:'high'}],['google','google/gemini-2.5-pro',{budget_tokens:2048}],['groq','groq/openai/gpt-oss-120b',{effort:'low'}],['nebius','nebius/Qwen/Qwen3.8-27B',{effort:'low'}],['deepseek','deepseek/deepseek-v4-flash',{effort:'high',toggle:true}],['xai','xai/grok-4.6',{effort:'high'}],['openai','openai/gpt-5',{effort:'low'}],['anthropic','anthropic/claude-opus-4-6',{effort:'low'}],['openrouter','openrouter/openai/gpt-5',{effort:'low'}],['anthropic-budget','anthropic/claude-opus-4-6',{thinking:'enabled',budget_tokens:2048}],['override','anthropic/claude-opus-4-6',{effort:'low'}],['anthropic-max','anthropic/claude-opus-5',{thinking:'adaptive',effort:'max'}]]){
  await createApiRuntime({tools:[]}).runTurn({bot:{id,name:id,runtime:'api',model,config:{modelConfig:{reasoning,...(reasoning.budget_tokens!==undefined?{outputLimit:64000}:{})}}},room:{id:'fixture',name:'fixture',members:[id],leadBotId:id},turnId:id,message:{payload:{text:'plain'}},prompt:'plain',hostedInput:{instructions:'Controlled model transport check',current:'plain',data:[],history:[]},resumed:false,state:{},saveState(){},ledger:{append(room,actor,type,payload){events.push({actor,type,payload});}},callTool(){throw Error('No tool requested by transport fixture');}});
  const request=requests.at(-1);if(id!=='google')assert.equal(request.body.model??request.body.preset,id==='override'?'gpt-5':model.slice(model.indexOf('/')+1));
  if(id==='deepinfra')assert.equal(request.body.reasoning_effort,'low');
  if(id==='mistral')assert.equal(request.body.reasoning_effort,'high');
  if(id==='cerebras')assert.equal(request.body.reasoning_effort,'low');
  if(id==='perplexity')assert.equal(request.body.reasoning.effort,'low');
  if(id==='alibaba'){assert.equal(request.body.enable_thinking,true);assert.ok(request.body.thinking_budget>0);}
  if(id==='google'){assert.ok(request.url.includes('generativelanguage.googleapis.com'));assert.equal(request.body.generationConfig.thinkingConfig.thinkingBudget,2048);}
  if(id==='groq'||id==='nebius')assert.equal(request.body.reasoning_effort,'low');
  if(id==='deepseek'){assert.equal(request.body.reasoning_effort,'high');assert.equal(request.body.thinking.type,'enabled');}
  if(id==='xai')assert.equal(request.body.reasoning.effort,'high');
  if(id==='override'){assert.ok(request.url.includes('api.openai.com'));assert.equal(request.body.reasoning?.effort??request.body.reasoning_effort,'low');}
  if(id==='openai')assert.equal(request.body.reasoning?.effort??request.body.reasoning_effort,'low');
  if(id==='anthropic')assert.equal(request.body.output_config.effort,'low');
  if(id==='anthropic-max'){assert.equal(request.body.thinking.type,'adaptive');assert.equal(request.body.output_config.effort,'max');}
  if(id==='anthropic-budget'){assert.equal(request.body.thinking.type,'enabled');assert.equal(request.body.thinking.budget_tokens,2048);assert.ok(request.body.max_tokens>2048);assert.ok(request.body.max_tokens<=64000);}
  if(id==='openrouter')assert.equal(request.body.reasoning.effort,'low');
  if(id!=='google')assert.ok(events.some(e=>e.actor===id&&e.type==='model_report'&&e.payload.model===responseModel),'Returned identity must survive Mastra '+id);
 }
 console.log('PASS: installed Mastra OpenAI/Anthropic/OpenRouter/Google/Groq/Nebius/DeepSeek/xAI/Alibaba/Mistral/Cerebras/Perplexity/DeepInfra transports receive selected model and provider-specific reasoning; returned model IDs survive runtime reporting where the adapter supplies them (Google does not). No real network.');
}finally{globalThis.fetch=originalFetch;}
