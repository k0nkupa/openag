// Standalone acceptance for the MCP environment-reference denylist. No provider calls; the connector is a stub, so nothing touches the network.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {isDaemonSecretEnvName,isForbiddenHeaderEnvName,isMcpReferenceName,newReferenceProblem}=await load('secret-env'),{withoutOwnerSecrets,claudeEnv}=await load('runtimes/acp');
const {modelProviders}=await load('providers'),{openDb}=await load('db/index'),{createMcpManager}=await load('mcp');
const parent=mkdtempSync(join(tmpdir(),'openag-env-refs-'));
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const saved={};const setEnv=values=>{for(const[key,value]of Object.entries(values)){saved[key]=process.env[key];process.env[key]=value;}};
try{
 // 1. The shared predicate is exactly the bot env stripper: the pre-extraction rules are reproduced here and compared key by key.
 const legacy=base=>{
  const env={...base};delete env.OPENAG_TOKEN;
  for(const name of modelProviders().flatMap(p=>p.envVars))delete env[name];
  for(const key of Object.keys(env))if(key.endsWith('_API_KEY'))delete env[key];
  for(const key of Object.keys(env))if(key.startsWith('OPENAG_SIGNIN_')||key.startsWith('OPENAG_GOOGLE_')||key.startsWith('OPENAG_COMPOSIO_')||key==='OPENAG_CONNECTOR_KEY'||key.startsWith('BROWSERBASE_')||key.startsWith('OPENAG_SSH_')||key.startsWith('SLACK_')||key.startsWith('OPENAG_RTC_')||key==='OPENAG_HEALTHCHECK_URL'||key==='OPENAG_BACKUP_DIR')delete env[key];
  return env;
 };
 const providerVars=[...new Set(modelProviders().flatMap(p=>p.envVars))];
 assert.ok(providerVars.length>5,'provider registry has env vars to cover');
 const sample={PATH:'/bin',HOME:'/h',LANG:'C',TMPDIR:'/t',OPENAG_DATA:'/d',OPENAG_PORT:'4747',OPENAG_TZ:'UTC',OPENAG_BOSS_MODEL:'x',MCP_REMOTE_TOKEN:'t',GITHUB_TOKEN:'g',EXAMPLE_TOKEN:'e',
  OPENAG_TOKEN:'owner',OPENAG_CONNECTOR_KEY:'k',OPENAG_HEALTHCHECK_URL:'u',OPENAG_BACKUP_DIR:'/b',BRAVE_API_KEY:'b',ANTHROPIC_API_KEY:'a',LINEAR_API_KEY:'l',TYPESAFE_API_KEY:'t',
  OPENAG_SIGNIN_X:'1',OPENAG_GOOGLE_X:'1',OPENAG_COMPOSIO_X:'1',OPENAG_SSH_HOST:'1',OPENAG_RTC_X:'1',BROWSERBASE_PROJECT_ID:'1',SLACK_BOT_TOKEN:'1',SLACK_APP_TOKEN:'1',
  ...Object.fromEntries(providerVars.map(name=>[name,'v']))};
 assert.deepEqual(Object.keys(withoutOwnerSecrets(sample)).sort(),Object.keys(legacy(sample)).sort(),'bot env stripping is unchanged by the extraction');
 for(const name of Object.keys(sample))assert.equal(isDaemonSecretEnvName(name),!(name in legacy(sample)),`predicate matches stripper for ${name}`);
 for(const name of ['PATH','HOME','OPENAG_DATA','OPENAG_PORT','MCP_REMOTE_TOKEN','GITHUB_TOKEN','EXAMPLE_TOKEN'])assert.equal(isDaemonSecretEnvName(name),false,`${name} is not a daemon secret`);
 for(const name of ['OPENAG_TOKEN','OPENAG_CONNECTOR_KEY','LINEAR_API_KEY','SLACK_BOT_TOKEN','BROWSERBASE_API_KEY','OPENAG_RTC_SECRET',...providerVars])assert.equal(isDaemonSecretEnvName(name),true,`${name} is a daemon secret`);
 assert.equal(isDaemonSecretEnvName('OPENAG_PORT'),false,'bot env keeps non-secret OPENAG_ settings');
 for(const name of ['OPENAG_PORT','OPENAG_DATA','OPENAG_UNKNOWN_FUTURE','OPENAG_TOKEN','LINEAR_API_KEY','SLACK_BOT_TOKEN',...providerVars])assert.equal(isForbiddenHeaderEnvName(name),true,`header may not reference ${name}`);
 for(const name of ['PATH','HOME','MCP_REMOTE_TOKEN','GITHUB_TOKEN'])assert.equal(isForbiddenHeaderEnvName(name),false,`header may reference ${name}`);
 // claudeEnv reuses the shared stripper: it never carries a daemon secret, keeps its own settings, and leaves its input alone.
 const claudeBase={OPENAG_TOKEN:'owner',ANTHROPIC_API_KEY:'k',SLACK_BOT_TOKEN:'s',PATH:'/usr/bin',OPENAG_PORT:'4747'};const claude=claudeEnv(claudeBase);
 assert.deepEqual(Object.keys(claude).filter(key=>isDaemonSecretEnvName(key)),[],'claudeEnv carries no daemon secret');
 assert.equal(claude.PATH,'/usr/bin');assert.equal(claude.CLAUDE_CODE_DISABLE_AUTO_MEMORY,'1');assert.ok(Number(claude.MCP_TOOL_TIMEOUT)>0);assert.equal(claudeBase.OPENAG_TOKEN,'owner','input is not mutated');
 // OPENAG_MCP_<NAME> is the one family an owner provides for MCP servers: stripped from bots, referenceable from a header.
 for(const name of ['OPENAG_MCP_LINEAR','OPENAG_MCP_A1_B2','OPENAG_MCP_LINEAR_API_KEY'])assert.equal(isMcpReferenceName(name),true,name);
 for(const name of ['OPENAG_MCP_','OPENAG_MCP','OPENAG_MCPX','openag_mcp_linear','MCP_LINEAR','OPENAG_MCP_lower','OPENAG_TOKEN'])assert.equal(isMcpReferenceName(name),false,name);
 assert.equal(isDaemonSecretEnvName('OPENAG_MCP_LINEAR'),true,'bots never inherit an OPENAG_MCP_ variable');
 assert.ok(!('OPENAG_MCP_LINEAR' in withoutOwnerSecrets({OPENAG_MCP_LINEAR:'v',PATH:'/bin'})),'bot env strips it');assert.ok(!('OPENAG_MCP_LINEAR' in claudeEnv({OPENAG_MCP_LINEAR:'v'})),'claudeEnv strips it');
 assert.equal(isForbiddenHeaderEnvName('OPENAG_MCP_LINEAR'),false,'a header may reference it');assert.equal(isForbiddenHeaderEnvName('OPENAG_MCP_LINEAR_API_KEY'),false,'even with an _API_KEY suffix');
 assert.equal(isForbiddenHeaderEnvName('OPENAG_BUSINESS_MCP_API_KEY'),false,'Existing operator headers retain their dedicated business credential reference');assert.equal(isDaemonSecretEnvName('OPENAG_BUSINESS_MCP_API_KEY'),true,'The legacy business credential still never reaches bot processes');assert.equal(newReferenceProblem([],['${OPENAG_BUSINESS_MCP_API_KEY}']),'OPENAG_BUSINESS_MCP_API_KEY','New desk references still use OPENAG_MCP_*');
 assert.equal(isForbiddenHeaderEnvName('OPENAG_TOKEN'),true);assert.equal(isForbiddenHeaderEnvName('OPENAG_MCPX_Y'),true,'no lookalike prefix gets through');
 // Write-time rule: only references that are new must be OPENAG_MCP_; an unchanged existing reference is left alone.
 assert.equal(newReferenceProblem([],['Bearer ${OPENAG_MCP_LINEAR}']),undefined);
 assert.equal(newReferenceProblem([],['${GITHUB_TOKEN}']),'GITHUB_TOKEN');
 assert.equal(newReferenceProblem(['Bearer ${GITHUB_TOKEN}'],['Token ${GITHUB_TOKEN}','x']),undefined,'an existing reference may stay or move');
 assert.equal(newReferenceProblem(['${GITHUB_TOKEN}'],['${GITHUB_TOKEN}','${HOME}']),'HOME','a new non-OPENAG_MCP_ reference next to an old one is refused');
 group('shared predicate equals the bot env stripper');

 // 2. Manager: a header may not reference a daemon secret; stdio entries and clean names are untouched; values never reach status.
 const SECRET='owner-secret-value-DO-NOT-LEAK-9f3a';
 setEnv({BRAVE_API_KEY:'',MCP_NOT_SET_ANYWHERE:''});delete process.env.BRAVE_API_KEY;delete process.env.MCP_NOT_SET_ANYWHERE; // the skip cases below need these unset, whatever the caller's shell has
 setEnv({OPENAG_TOKEN:SECRET,MCP_REMOTE_TOKEN:'remote-token-value-ok',LINEAR_API_KEY:'linear-key-value-1234',OPENAG_PORT:'4747'});
 let connected=[];
 const connector=async cfg=>{connected.push(cfg);throw new Error('stub connector: no network in this check');};
 const manage=async(entry)=>{
  const dir=mkdtempSync(join(parent,'m-'));openDb(dir).close();
  writeFileSync(join(dir,'mcp.json'),JSON.stringify({servers:[{id:'remote',timeoutMs:3000,...entry}]}),{mode:0o600});
  const manager=createMcpManager({dataDir:dir,connector});
  try{await manager.load();return manager.status().find(server=>server.id==='remote');}finally{await manager.close();}
 };
 const http=headers=>({transport:'http',url:'https://example.com/mcp',headers});
 let status=await manage(http({Authorization:'Bearer ${OPENAG_TOKEN}'}));
 assert.equal(status.state,'invalid');assert.equal(status.detail,'invalid: header references a daemon secret (OPENAG_TOKEN)');
 assert.ok(!JSON.stringify(status).includes(SECRET),'status never carries the secret value');
 for(const name of ['OPENAG_PORT','OPENAG_DATA','LINEAR_API_KEY','SLACK_BOT_TOKEN','BROWSERBASE_API_KEY',providerVars.find(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),'OPENAG_UNKNOWN_FUTURE'])
  {status=await manage(http({'X-Key':`prefix-\${${name}}-suffix`}));assert.equal(status.state,'invalid',`${name} refused`);assert.match(status.detail,/header references a daemon secret/);}
 status=await manage(http({Authorization:'Bearer ${302AI_API_KEY}'}));assert.equal(status.state,'invalid');assert.match(status.detail,/malformed/,'a name that cannot be a reference is refused by the existing malformed-reference rule, not the denylist');
 status=await manage(http({A:'ok','B':'Bearer ${MCP_REMOTE_TOKEN} and ${OPENAG_TOKEN}'}));assert.equal(status.detail,'invalid: header references a daemon secret (OPENAG_TOKEN)','any one denied reference among several refuses the entry, naming it');
 assert.equal(connected.length,0,'a refused entry never reaches the connector');
 status=await manage(http({Authorization:'Bearer ${OPENAG_MCP_LINEAR}'}));assert.notEqual(status.state,'invalid',`OPENAG_MCP_ passes the static check: ${status.detail}`);
 status=await manage(http({Authorization:'Bearer ${MCP_REMOTE_TOKEN}'}));
 assert.notEqual(status.state,'invalid',`a clean name passes the static check: ${status.detail}`);
 assert.equal(connected.length,1,'a clean entry reaches the connector');assert.equal(connected[0].headers.Authorization,'Bearer remote-token-value-ok','the clean reference resolves to its value');connected=[];
 status=await manage(http({Authorization:'Bearer ${MCP_NOT_SET_ANYWHERE}'}));assert.equal(status.state,'skipped','unset clean name keeps the existing missing-env skip');assert.match(status.detail,/missing env MCP_NOT_SET_ANYWHERE/);
 status=await manage({transport:'http',url:'https://example.com/${OPENAG_TOKEN}'});assert.equal(status.state,'invalid');assert.match(status.detail,/url must not use references/,'url references remain refused');
 // Stdio is unchanged: the shipped Brave example references BRAVE_API_KEY in env and must keep working (inert until the key exists).
 status=await manage({transport:'stdio',command:'node',args:[],env:{BRAVE_API_KEY:'${BRAVE_API_KEY}'}});
 assert.equal(status.state,'skipped','stdio env may still reference an API key; missing variable skips the server');assert.match(status.detail,/missing env BRAVE_API_KEY/);
 group('manager refuses daemon-secret header references, leaves stdio and clean names alone');
}finally{
 for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(parent,{recursive:true,force:true});
}
console.log(`MCP env-reference verification passed (${groups} groups).`);
