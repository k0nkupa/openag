// A controlled fake OAuth authorization server plus an MCP resource server that needs its bearer. Loopback only; synthetic data.
// Knobs break one rule at a time so the daemon's refusals can be proven; stats show what the server actually received.
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const {serve}=require('@hono/node-server');
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const b64=buffer=>Buffer.from(buffer).toString('base64url');
export async function startOAuthFixture(){
 const knobs={missingS256:false,plainOnly:false,issuerMismatch:false,omitIss:false,wrongIss:false,advertiseIss:true,noRegistration:false,cimd:false,delayRefresh:0,failRefresh:null,forbidScope:null,resourceElsewhere:false,tokenType:'Bearer',bigDescription:false,mcpDelay:0,rejectTokens:new Set(),linkLocalEndpoint:false,noPrm:false,nonExpiring:false};
 const stats={registers:[],exchanges:0,refreshes:0,refreshReuse:0,mcpCalls:[],mcpUnauth:0,authHeaders:[],tools:0};
 const clients=new Map(),codes=new Map(),access=new Map(),refresh=new Map();
 let base='';
 const json=(status,body,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
 const tokenError=(error,status=400)=>json(status,{error,error_description:error});
 const mint=(clientId,scope)=>{const token='at-'+b64(randomBytes(24)),rt='rt-'+b64(randomBytes(24));access.set(token,{clientId,scope});if(knobs.nonExpiring)return {access_token:token,token_type:knobs.tokenType};refresh.set(rt,{used:false,clientId,scope});return {access_token:token,token_type:knobs.tokenType,expires_in:3600,refresh_token:rt,...(scope?{scope}:{})};};
 const resourceServer=async req=>{
  const auth=req.headers.get('authorization')??'';stats.authHeaders.push(auth);
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(knobs.mcpDelay)await new Promise(resolve=>setTimeout(resolve,knobs.mcpDelay));
  if(!access.has(token)||knobs.rejectTokens.has(token)){stats.mcpUnauth++;return new Response('',{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`}});}
  if(req.method!=='POST')return new Response('',{status:405});
  const body=await req.clone().json().catch(()=>({}));
  if(knobs.forbidScope&&body.method==='tools/call'){return new Response('',{status:403,headers:{'www-authenticate':`Bearer error="insufficient_scope", scope="${knobs.forbidScope}"`}});}
  const server=new Server({name:'oauth-fixture',version:'1'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['LOOKUP_ITEM','LOOKUP_ITEM_WITH_A_DELIBERATELY_LONG_NAME_FOR_ADAPTER_NAMING_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(name=>({name,description:knobs.bigDescription?'x'.repeat(100000):'Synthetic acceptance only.',inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{stats.mcpCalls.push({name:params.name,token});return {content:[{type:'text',text:JSON.stringify({successful:true,marker:'OAUTH_FIXTURE_RETURNED'})}]};});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);return transport.handleRequest(req);
 };
 const handler=async req=>{
  const url=new URL(req.url),path=url.pathname;
  if(path==='/mcp')return resourceServer(req);
  if(path.startsWith('/.well-known/oauth-protected-resource'))return knobs.noPrm?new Response('',{status:404}):json(200,{resource:knobs.resourceElsewhere?'https://elsewhere.example/mcp':base+'/mcp',authorization_servers:[base]});
  if(path==='/.well-known/oauth-authorization-server')return json(200,{
   issuer:knobs.issuerMismatch?'https://evil.example':base,authorization_endpoint:knobs.linkLocalEndpoint?'http://169.254.169.254/authorize':base+'/authorize',token_endpoint:base+'/token',
   ...(knobs.noRegistration?{}:{registration_endpoint:base+'/register'}),response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
   ...(knobs.missingS256?{}:{code_challenge_methods_supported:knobs.plainOnly?['plain']:['S256']}),token_endpoint_auth_methods_supported:['none','client_secret_post'],
   ...(knobs.advertiseIss?{authorization_response_iss_parameter_supported:true}:{}),...(knobs.cimd?{client_id_metadata_document_supported:true}:{})});
  if(path==='/register'&&req.method==='POST'){
   const body=await req.json();stats.registers.push(body);
   if(body.application_type!=='web'||!Array.isArray(body.redirect_uris)||!body.redirect_uris.length)return json(400,{error:'invalid_client_metadata'});
   const id='client-'+b64(randomBytes(8));clients.set(id,{redirect_uris:body.redirect_uris});return json(201,{...body,client_id:id});
  }
  if(path==='/authorize'){
   const p=url.searchParams,clientId=p.get('client_id')??'';
   const known=clients.get(clientId)??(knobs.cimd||/^https:/.test(clientId)||clientId.startsWith('preset-')?{redirect_uris:[p.get('redirect_uri')]}:undefined);
   if(!known||p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256'||!p.get('code_challenge')||!known.redirect_uris.includes(p.get('redirect_uri')))return new Response('bad request',{status:400});
   if(knobs.noPrm?p.get('resource')!==null:p.get('resource')!==base+'/mcp'&&!knobs.resourceElsewhere)return new Response('bad resource',{status:400});
   const code='code-'+b64(randomBytes(18));codes.set(code,{clientId,challenge:p.get('code_challenge'),redirect:p.get('redirect_uri'),scope:p.get('scope')??undefined});
   const back=new URL(p.get('redirect_uri'));back.searchParams.set('code',code);back.searchParams.set('state',p.get('state'));
   if(!knobs.omitIss)back.searchParams.set('iss',knobs.wrongIss?'https://evil.example':base);
   return new Response('',{status:302,headers:{location:back.href}});
  }
  if(path==='/token'&&req.method==='POST'){
   const form=new URLSearchParams(await req.text()),grant=form.get('grant_type');
   if(grant==='authorization_code'){
    if(knobs.expectedClientSecret !== undefined && form.get('client_secret') !== knobs.expectedClientSecret) return tokenError('invalid_client');
    const entry=codes.get(form.get('code')??'');codes.delete(form.get('code')??'');
    if(!entry||entry.redirect!==form.get('redirect_uri')||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==entry.challenge)return tokenError('invalid_grant');
    stats.exchanges++;return json(200,mint(entry.clientId,entry.scope));
   }
   if(grant==='refresh_token'){
    stats.refreshes++;if(knobs.delayRefresh)await new Promise(resolve=>setTimeout(resolve,knobs.delayRefresh));
    if(knobs.failRefresh==='server_error')return json(503,{error:'server_error'});
    if(knobs.failRefresh)return tokenError(knobs.failRefresh);
    const record=refresh.get(form.get('refresh_token')??'');
    if(!record)return tokenError('invalid_grant');
    if(record.used){stats.refreshReuse++;return tokenError('invalid_grant');}
    record.used=true;return json(200,mint(record.clientId,record.scope));
   }
   return tokenError('unsupported_grant_type');
  }
  return new Response('not found',{status:404});
 };
 const server=serve({hostname:'127.0.0.1',port:0,fetch:handler});
 if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
 return {
  base,mcpUrl:base+'/mcp',knobs,stats,
  /** What the browser would do: follow the authorize redirect and report the callback parameters. */
  async authorize(authorizationUrl){const response=await fetch(authorizationUrl,{redirect:'manual'});if(response.status!==302)throw Error('authorize refused: '+response.status);return Object.fromEntries(new URL(response.headers.get('location')).searchParams);},
  revokeAll(){access.clear();refresh.clear();},
  async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
 };
}
