import { useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { messageOf, type Api } from '../api';
import type { RequestPage } from '../types';
import { Button } from './ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Progress } from './ui/progress';
const fields=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;

export function RequestUsage({api,turnId}:{api:Api;turnId:string}) {
  const [open,setOpen]=useState(false),[page,setPage]=useState<RequestPage>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const busy=useRef(false),generation=useRef(0);
  useEffect(()=>{generation.current++;busy.current=false;setPage(undefined);setError('');setLoading(false);return()=>{generation.current++;};},[api,turnId]);
  async function load(){
    if(busy.current)return;busy.current=true;setLoading(true);setError('');const version=generation.current;
    try{const result=await api.getRequestManifests(turnId);if(version===generation.current)setPage(result);}
    catch(e){if(version===generation.current){setPage(undefined);setError(messageOf(e));}}
    finally{if(version===generation.current){busy.current=false;setLoading(false);}}
  }
  function change(next:boolean){setOpen(next);if(next&&!page)void load();}
  const record=page?.records[0],usage=fields(record?.evidence.findLast(item=>item.status==='returned')?.usage);
  const input=count(usage.inputTokens??usage.prompt_eval_count),output=count(usage.outputTokens??usage.eval_count);
  const context=record?.manifest.context,required=count(context?.requiredCharacters),limit=count(context?.limit);
  return <HoverCard open={open} onOpenChange={change}><HoverCardTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Request usage" onClick={()=>change(!open)} />}><Gauge /></HoverCardTrigger>
    <HoverCardContent align="start" className="flex w-80 flex-col gap-3"><p className="font-medium">Latest request</p>
      {loading&&<p role="status" className="text-sm">Loading…</p>}
      {error&&<p role="alert" className="text-sm">{error}</p>}
      {page&&!record&&<p className="text-sm">Not recorded</p>}
      {record&&<><p className="break-words text-sm">{record.manifest.requestedModel}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Input tokens</dt><dd>{input===undefined?'Not reported':input.toLocaleString()}</dd><dt>Output tokens</dt><dd>{output===undefined?'Not reported':output.toLocaleString()}</dd></dl>
        {required!==undefined&&limit!==undefined&&limit>0&&<><p className="text-xs">Required input · {required.toLocaleString()} / {limit.toLocaleString()} characters</p><Progress value={Math.min(100,required/limit*100)} aria-label="Required input character budget" /></>}
      </>}
      <Button size="sm" variant="outline" disabled={loading} onClick={()=>void load()}>Refresh usage</Button>
    </HoverCardContent>
  </HoverCard>;
}
