import { useState, type ReactNode } from 'react';
import { ArrowUpRight, CircleCheck, CircleX, File, Folder, Globe, ListChecks } from 'lucide-react';
import type { ActivityItem } from '../activity';
import { EvidenceBlock } from './EvidenceBlock';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from './ui/trace';
const fields=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function parseRecordedTests(text:string) {
  if(text.length>128000)return;
  const count=(name:string,optional=false)=>{const rows=[...text.matchAll(new RegExp('^#\\s*'+name+'\\s+(\\d+)\\s*$','gm'))];if(!rows.length&&optional)return 0;if(rows.length!==1)return;const value=Number(rows[0]![1]);return Number.isSafeInteger(value)&&value>=0&&value<=10000?value:undefined;};
  const total=count('tests'),passed=count('pass'),failed=count('fail'),skipped=count('skipped',true),todo=count('todo',true),cancelled=count('cancelled',true);
  if(total===undefined||passed===undefined||failed===undefined||skipped===undefined||todo===undefined||cancelled===undefined||passed+failed+skipped+todo+cancelled!==total)return;
  const cases=[...text.matchAll(/^\s*(not ok|ok) \d+ - ([^\n\r]+)$/gm)].slice(0,200).map(match=>({failed:match[1]==='not ok',title:match[2]!.slice(0,300)}));
  return {total,passed,failed,skipped,todo,cancelled,cases};
}

export function RecordedOutput({stdout,stderr}:{stdout:string;stderr:string}) {
  const tests=parseRecordedTests(stdout);
  const frames=stderr.length<=128000?stderr.split('\n').filter(line=>/^\s*at\s+.+:\d+(?::\d+)?\)?\s*$/.test(line)).slice(0,100):[];
  return <Trace aria-label="Recorded output summaries">
    {tests&&<TraceCollapsible><TraceCollapsibleTrigger><TraceLine status={tests.failed?'error':undefined}>
      <TraceIcon><ListChecks /></TraceIcon><TraceTitle>Reported test results</TraceTitle><TraceDescription>{tests.passed} passed · {tests.failed} failed{tests.skipped?` · ${tests.skipped} skipped`:''}{tests.todo?` · ${tests.todo} todo`:''}{tests.cancelled?` · ${tests.cancelled} cancelled`:''}</TraceDescription>
    </TraceLine></TraceCollapsibleTrigger><TraceCollapsibleContent><Trace>{tests.cases.map((test,index)=><TraceLine key={index} status={test.failed?'error':undefined}><TraceIcon>{test.failed?<CircleX />:<CircleCheck />}</TraceIcon><TraceTitle title={test.title}>{test.title}</TraceTitle></TraceLine>)}</Trace>{tests.cases.length<tests.total&&<p className="text-xs">Full recorded output is below.</p>}</TraceCollapsibleContent></TraceCollapsible>}
    {!!frames.length&&<TraceCollapsible><TraceCollapsibleTrigger><TraceLine><TraceIcon><CircleX /></TraceIcon><TraceTitle>Reported stack trace</TraceTitle><TraceDescription>{frames.length} {frames.length===1?'frame':'frames'}</TraceDescription></TraceLine></TraceCollapsibleTrigger><TraceCollapsibleContent><EvidenceBlock>{frames.join('\n')}</EvidenceBlock></TraceCollapsibleContent></TraceCollapsible>}
  </Trace>;
}

type SearchSource={url:string;title:string;description:string};
export function recordedSources(value:unknown):SearchSource[] {
  const result=fields(value);
  if(result.source!=='brave'||result.truncated===true||!Array.isArray(result.results))return [];
  const sources=new Map<string,SearchSource>();
  for(const raw of result.results.slice(0,10)){
    const item=fields(raw);if(typeof item.url!=='string'||item.url.length>2048)continue;
    try{const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;
      sources.set(url.href,{url:url.href,title:typeof item.title==='string'?item.title.slice(0,512):url.hostname,description:typeof item.description==='string'?item.description.slice(0,1024):''});
    }catch{/* Untrusted malformed URLs are not links. */}
  }
  return [...sources.values()];
}
export function RecordedSources({value}:{value:unknown}) {
  const sources=recordedSources(value);if(!sources.length)return null;
  return <Trace aria-label="Returned search sources"><TraceCollapsible>
    <TraceCollapsibleTrigger><TraceLine><TraceIcon><Globe /></TraceIcon><TraceTitle>Search results</TraceTitle><TraceDescription>{sources.length} {sources.length===1?'source':'sources'} returned</TraceDescription></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent><div className="flex flex-col items-start gap-3">{sources.map(source=><div key={source.url} className="flex min-w-0 flex-wrap items-center gap-2">
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-2 underline"><span className="truncate">{source.title}</span><ArrowUpRight className="size-3 shrink-0" /><span className="sr-only"> (opens in a new tab)</span></a>
      <HoverCard><HoverCardTrigger render={<Button variant="secondary" size="xs" />}>{new URL(source.url).hostname}</HoverCardTrigger><HoverCardContent className="flex w-72 flex-col gap-2"><p className="font-medium">{source.title}</p>{source.description&&<p className="text-sm">{source.description}</p>}<a className="break-all text-xs underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a></HoverCardContent></HoverCard>
    </div>)}</div></TraceCollapsibleContent>
  </TraceCollapsible></Trace>;
}

type FileNode={children:Map<string,FileNode>;item?:ActivityItem;path:string};
export function RecordedFiles({items}:{items:readonly ActivityItem[]}) {
  const [selected,setSelected]=useState<string>();
  const files=new Map<string,ActivityItem>();
  for(const item of items){
    if(fields(item.event.payload).executionOutcome!=='completed')continue;
    const call=item.history.find(event=>event.type==='tool_call'&&fields(event.payload).tool==='write_file');
    const args=fields(fields(call?.payload).args),path=args.path??args.file_path;
    if(typeof path==='string'&&path&&path.length<=2048&&path.replaceAll('\\','/').split('/').filter(Boolean).length<=32)files.set(path,item);
    if(files.size===64)break;
  }
  if(!files.size)return null;
  const root:FileNode={children:new Map(),path:''};
  for(const [path,item]of files){let node=root;for(const segment of path.replaceAll('\\','/').split('/').filter(Boolean)){let next=node.children.get(segment);if(!next){next={children:new Map(),path};node.children.set(segment,next);}node=next;}node.item=item;node.path=path;}
  const nodes=(node:FileNode):ReactNode=>[...node.children].sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=><div key={name} className="min-w-0">
    {child.children.size?<Collapsible defaultOpen><CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start" />}><Folder />{name}</CollapsibleTrigger><CollapsibleContent className="ml-4">{nodes(child)}</CollapsibleContent></Collapsible>:null}
    {child.item&&<Button variant="ghost" size="sm" className="w-full justify-start" title={child.path} onClick={()=>setSelected(child.path)}><File />{name}</Button>}
  </div>);
  const chosen=selected?files.get(selected):undefined;
  return <Trace aria-label="Recorded file changes"><TraceCollapsible><TraceCollapsibleTrigger><TraceLine><TraceIcon><Folder /></TraceIcon><TraceTitle>Recorded file changes</TraceTitle><TraceDescription>{files.size===64?'First 64':files.size} {files.size===1?'file':'files'}</TraceDescription></TraceLine></TraceCollapsibleTrigger><TraceCollapsibleContent>
    {nodes(root)}{chosen&&<EvidenceBlock>{JSON.stringify(chosen.history,null,2)}</EvidenceBlock>}
  </TraceCollapsibleContent></TraceCollapsible></Trace>;
}
