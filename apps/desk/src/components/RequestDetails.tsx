import { ReceiptLink } from './ReceiptView';
import { useEffect, useRef, useState } from 'react';
import { messageOf, type Api } from '../api';
import type { RequestPage, RequestRecord } from '../types';
import { useStream } from '../stream';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Skeleton } from './ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle } from './ui/empty';
import { Disclosure } from './Disclosure';
import { EvidenceBlock } from './EvidenceBlock';

function RequestStep({record}:{record:RequestRecord}) {
  const m=record.manifest,last=record.evidence.at(-1),status=last?.status;
  const label=m.boundary==='admission'?'Not sent':!record.evidence.some(e=>e.status==='started')?'Not dispatched':status==='returned'?'Returned':status==='failed'?'Failed':status==='cancelled'?'Cancelled':status==='interrupted'?'Interrupted':record.turnStatus==='running'?'Awaiting evidence':'Settlement unavailable';
  const sources=m.context?.sources??[],omitted=sources.filter(s=>s.reason).length+(m.context?.historyOmitted??0);
  return <section className="flex min-w-0 flex-col gap-3" aria-label={`${m.boundary==='acp-handoff'?'Handoff':'Step'} ${m.step}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-all">{m.boundary==='acp-handoff'?'Handoff':'Step'} {m.step} · {m.requestedModel==='adapter-default'?m.session?.reportedModel??m.requestedModel:m.requestedModel}</h3><Badge variant={status==='returned'?'success':status==='failed'||m.boundary==='admission'?'destructive':'attention'}>{label}</Badge></div>
    <p className="text-muted-foreground">{m.messages.length+m.messageOverflow} messages · {m.toolCount} tools{omitted?` · ${omitted} sources omitted or shortened`:''}</p>
    {m.session&&<p className="text-muted-foreground">{m.session.context==='fresh'?'New':'Reused'} ACP session · child requests unavailable</p>}
    <Disclosure title="Context"><div className="flex flex-col gap-2">{sources.map((s,i)=><div key={i} className="flex flex-wrap justify-between gap-2"><span>{s.source}{s.reference?` #${s.reference}`:''}</span><span>{s.selectedCharacters.toLocaleString()} / {s.characters.toLocaleString()} characters{s.reason?` · ${s.reason}`:''}</span></div>)}{m.context&&<p className="text-muted-foreground">JavaScript string-length units. Required input: {m.context.requiredCharacters.toLocaleString()} / {m.context.limit===null?'capacity unavailable':m.context.limit.toLocaleString()}. Earlier source clipping: unavailable.</p>}{m.sourceOverflow>0&&<p>{m.sourceOverflow} additional source descriptors omitted.</p>}</div></Disclosure>
    <Disclosure title={`Attempts · ${record.evidence.filter(e=>e.status==='started').length}`}><EvidenceBlock>{JSON.stringify(record.evidence,null,2)}</EvidenceBlock></Disclosure>
    <Disclosure title="Technical details"><EvidenceBlock>{JSON.stringify(m,null,2)}</EvidenceBlock></Disclosure>
  </section>;
}
export function RequestDetails({api,turnId,originRoomId}:{api:Api;turnId:string;originRoomId?:string}) {
  const [open,setOpen]=useState(false),[page,setPage]=useState<RequestPage>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false);
  const {subscribe}=useStream(),controls=useRef<(older?:boolean)=>void>(()=>{});
  useEffect(()=>{
    if(!open)return;
    let active=true,busy=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined;
    let cursor:number|null=null,records:RequestRecord[]=[];
    setPage(undefined);setError(undefined);
    const schedule=()=>{if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void load();},300);};
    const read=(before?:number)=>originRoomId?api.getAgentRequestManifests(originRoomId,turnId,before):api.getRequestManifests(turnId,before);
    async function load(older=false){
      if(busy){queued=true;return;}busy=true;setLoading(true);
      try{
        let next=await read(older&&cursor!==null?cursor:undefined);
        const incoming=[...next.records],newest=records[0]?.id;
        // Catch up to the previous newest record before merging, even after a burst of model steps.
        while(active&&!older&&newest!==undefined&&next.nextCursor!==null&&!incoming.some(record=>record.id<=newest)){
          next=await read(next.nextCursor);incoming.push(...next.records);
        }
        if(active){
          const status=incoming[0]?.turnStatus;
          const merged=new Map(records.map(record=>[record.id,status?{...record,turnStatus:status}:record]));
          for(const record of incoming)merged.set(record.id,record);
          if(older||records.length===0)cursor=next.nextCursor;
          records=[...merged.values()].sort((a,b)=>b.id-a.id);
          setPage({records,nextCursor:cursor,receipts:next.receipts});setError(undefined);
        }
      }
      catch(err){if(active){records=[];cursor=null;setError(messageOf(err));setPage(undefined);}}
      finally{busy=false;if(active){setLoading(false);if(queued){queued=false;schedule();}}}
    }
    controls.current=older=>void load(older);void load();
    const off=subscribe({onOpen:schedule,onEvent:event=>{const p=event.payload as {turnId?:unknown;id?:unknown}|null;if((p?.turnId===turnId&&['request_prepared','request_attempt','turn_finished'].includes(event.type))||(originRoomId&&event.roomId===originRoomId&&event.type==='agent_request'&&p?.id===turnId))schedule();}});
    return ()=>{active=false;clearTimeout(timer);off();controls.current=()=>{};};
  },[api,turnId,originRoomId,open,subscribe]);
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger render={<Button variant="ghost" size="sm"/>}>Request details</SheetTrigger><SheetContent size="wide"><SheetHeader><SheetTitle>Request details</SheetTitle><SheetDescription>Recorded inputs and request attempts.</SheetDescription></SheetHeader><div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-4 pb-6">
    {error&&<Alert variant="destructive"><AlertDescription>{error} <Button variant="outline" onClick={()=>controls.current()}>Retry</Button></AlertDescription></Alert>}
    {!page&&loading&&<Skeleton className="h-24 w-full"/>}
    {page?.records.length===0&&<Empty><EmptyHeader><EmptyTitle>Not recorded</EmptyTitle></EmptyHeader></Empty>}
    {page?.records.map(record=><RequestStep key={record.id} record={record}/>)}
    {page?.nextCursor!==null&&page&&<Button variant="outline" disabled={loading} onClick={()=>controls.current(true)}>Earlier steps</Button>}
    {!!page?.receipts?.length&&<Disclosure title="Execution receipts"><div className="flex flex-col gap-2">{page.receipts.map(receipt=><ReceiptLink key={receipt.id} approvalId={receipt.id} label={receipt.toolName}/>)}</div></Disclosure>}
    {!!page?.records.length&&<p className="text-muted-foreground">Fingerprints identify recorded metadata. They cannot reconstruct the original request.</p>}
  </div></SheetContent></Sheet>;
}
