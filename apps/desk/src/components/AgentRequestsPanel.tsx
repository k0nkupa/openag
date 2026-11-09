import { useEffect, useMemo, useState } from 'react';
import { hrefFor } from '../route';
import type { Api } from '../api';
import type { AgentRequest, BotInfo, LedgerEvent } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { RequestDetails } from './RequestDetails';
import { ReceiptLink } from './ReceiptView';
import { ActivityTrace, isActivity } from './ActivityTrace';
import { Bot } from 'lucide-react';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from './ui/trace';

export function AgentRequestsPanel({api,roomId,events,bots,canManage=false}:{canManage?:boolean;api:Api;roomId:string;events:readonly LedgerEvent[];bots:readonly BotInfo[]}) {
  const [stored,setStored]=useState<AgentRequest[]>([]),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{let active=true;void api.agentRequests(roomId).then(r=>{if(active)setStored(r.requests);}).catch(()=>{if(active)setError('Could not load agent requests.');});return()=>{active=false;};},[api,roomId]);
  const requests=useMemo(()=>{
    const rows=new Map(stored.map(r=>[r.id,r]));
    for(const event of events)if(event.type==='agent_request'){const r=event.payload as AgentRequest;if(!rows.has(r.id)||rows.get(r.id)!.revision<r.revision)rows.set(r.id,r);}
    const ordered=[...rows.values()].sort((a,b)=>a.createdAt-b.createdAt);
    const outstanding=(r:AgentRequest)=>r.status==='accepted'||r.status==='running'||r.delivery==='pending';
    return [...ordered.filter(outstanding),...ordered.filter(r=>!outstanding(r)).slice(-3)];
  },[stored,events]);
  async function cancel(id:string){setBusy(id);setError(null);try{const {request}=await api.cancelAgentRequest(roomId,id);setStored(rows=>[...rows.filter(r=>r.id!==id),request]);}catch{setError('Could not cancel the agent request.');}finally{setBusy(null);}}
  if(!requests.length&&!error)return null;
  return <div className="flex max-h-80 shrink-0 flex-col gap-2 overflow-auto px-4 py-2" aria-label="Agent requests">
    {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Trace>{requests.map(r=>{const active=r.status==='accepted'||r.status==='running';
      const variant=r.status==='cancelled'?'secondary':r.status==='failed'||r.status==='expired'||(r.delivery==='failed'&&r.status!=='interrupted')?'destructive':r.status==='completed'&&r.delivery==='delivered'?'success':'attention';
      const label=r.pendingInteractionIds.length?'Needs input':r.status==='completed'?(r.delivery==='pending'?'Preparing answer':r.delivery==='failed'?'Answer not delivered':'Answered'):r.status==='accepted'?'Requested':r.status==='running'?'Working':r.status[0].toUpperCase()+r.status.slice(1);
      const activity=events.filter(event=>event.roomId===roomId&&isActivity(event)&&(event.payload as {turnId?:string}|null)?.turnId===r.id);
      return <TraceCollapsible key={r.id}>
        <TraceCollapsibleTrigger><TraceLine status={r.status==='failed'||r.status==='expired'?'error':active?'running':undefined}>
          <TraceIcon><Bot /></TraceIcon><TraceTitle>{bots.find(b=>b.id===r.recipientId)?.name??r.recipientId}</TraceTitle><Badge variant={variant} role="status">{label}</Badge>
        </TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {r.result&&<p className="whitespace-pre-wrap break-words text-sm">{r.result.slice(0,2000)}{r.result.length>2000?'…':''}</p>}
          {!!activity.length&&<ActivityTrace events={activity} bots={bots} api={api} canManage={canManage}/>}
          <div className="flex flex-wrap items-center gap-2">
            {(active||(r.kind==='consultation'&&r.delivery==='pending'&&!['cancelled','expired','interrupted'].includes(r.status)))&&<Button variant="ghost" size="sm" disabled={busy===r.id} onClick={()=>void cancel(r.id)}>Cancel</Button>}
            {canManage&&!!r.pendingInteractionIds.length&&<Button variant="ghost" size="sm" render={<a href={hrefFor({kind:"room",roomId})}/>}>Open Conversation</Button>}
            {canManage&&<RequestDetails api={api} turnId={r.id} originRoomId={roomId}/>}
            {r.receiptIds.map(id=><ReceiptLink key={id} approvalId={id} label="Receipt"/>)}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>;})}</Trace>
  </div>;
}
