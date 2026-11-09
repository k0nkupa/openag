import { Card, CardContent } from "./ui/card";
import {useEffect,useRef,useState} from "react";
import {messageOf,type Api} from "../api";
import type {AutomationRun} from "../types";
import {useStream} from "../stream";
import {hrefFor} from "../route";
import {Button} from "./ui/button";
import {Badge} from "./ui/badge";
import {Alert,AlertDescription} from "./ui/alert";
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from "./ui/sheet";
import {ResultsPanel} from "./ResultsPanel";

const diagnosticLabels:Partial<Record<AutomationRun['outcome'],string>>={missed:'Missed',skipped:'Skipped',start_failed:'Start failed',coverage_gap:'Coverage gap'};
const outcomeLabel=(outcome:AutomationRun['outcome'])=>diagnosticLabels[outcome]??outcome;
const outcomeVariant=(outcome:AutomationRun['outcome']) => outcome === 'failed' || outcome === 'start_failed' ? 'destructive' : ['completed','quiet'].includes(outcome) ? 'success' : outcome === 'cancelled' || outcome === 'skipped' ? 'secondary' : 'attention';
const reasons:Record<string,string>={scan_limit:'Gap exceeds the bounded scheduling scan',daemon_gap:'Daemon was unavailable',scheduler_delay:'Scheduler was delayed',availability_unknown:'Past availability is uncertain',configuration_changed:'Configuration changed',schedule_unavailable:'Schedule unavailable',admission_error:'Could not reserve an execution'};
const reasonLabel=(reason:string)=>Object.hasOwn(reasons,reason)?reasons[reason]:reason;

export function AutomationHistory({api,automationId,onAll,runId,onSelectRun}:{api:Api;automationId?:string;onAll:()=>void;runId?:string;onSelectRun?:(id?:string)=>void}){
 const {subscribe}=useStream();
 const [rows,setRows]=useState<AutomationRun[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState<string>(),[loading,setLoading]=useState(true),[selected,setSelected]=useState<AutomationRun>();
 const controlled=!!onSelectRun;
 const selectedId=useRef<string|undefined>(undefined);selectedId.current=controlled?runId:selected?.id;
 const pageCount=useRef(1),previousScope=useRef(automationId),lastRun=useRef(runId),heading=useRef<HTMLHeadingElement>(null);
 if(runId)lastRun.current=runId;
 const controls=useRef({refresh:()=>{},more:()=>{}});
 useEffect(()=>{
  if(previousScope.current!==automationId){pageCount.current=1;previousScope.current=automationId;setRows([]);setNext(null);}
  let active=true,fetching=false,queued=false,pages=pageCount.current,cursor:number|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  setLoading(true);if(controlled)setSelected(undefined);
  const schedule=()=>{if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void load();},350);};
  async function load(){
   if(fetching){queued=true;return;}fetching=true;
   try{
    const items:AutomationRun[]=[];let before:number|undefined;
    for(let page=0;page<pages;page++){const result=await api.listAutomationRuns(automationId,before);if(!active)return;items.push(...result.runs);cursor=result.nextCursor;if(!cursor)break;before=cursor;}
    let detail:AutomationRun|undefined;
    if(selectedId.current)detail=items.find(item=>item.id===selectedId.current)??(await api.getAutomationRun(selectedId.current)).run;
    if(detail&&automationId&&detail.automationId!==automationId)throw Error("This run belongs to a different automation.");
    if(active){setRows(items);setNext(cursor);setError(undefined);if(detail&&detail.id===selectedId.current)setSelected(detail);}
   }catch(err){if(active)setError(messageOf(err));}
   finally{fetching=false;if(active){setLoading(false);if(queued){queued=false;schedule();}}}
  }
  controls.current={refresh:()=>void load(),more:()=>{if(!fetching&&cursor){pages++;pageCount.current=pages;void load();}}};
  void load();const off=subscribe({onOpen:schedule,onEvent:event=>{if(event.type==='automation_updated')schedule();}});
  return()=>{active=false;clearTimeout(timer);off();};
 },[api,automationId,subscribe,controlled,runId]);
 return <section className="mt-8 flex min-w-0 flex-col gap-4" aria-label="Automation run history">
  <header className="flex flex-wrap items-center justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{automationId?'Automation history':'Recent runs'}</h2><div className="flex gap-2">{automationId&&<Button variant="ghost" onClick={onAll}>Show all runs</Button>}<Button variant="outline" onClick={()=>controls.current.refresh()}>Refresh history</Button></div></header>
  <p className="text-muted-foreground">Quiet checks stay here. Outcomes and delivery are recorded separately. Missed schedules and start refusals are history diagnostics, not executions. Older runs without records are not reconstructed.</p>
  {error&&<Alert variant="destructive"><AlertDescription>Could not refresh history: {error}</AlertDescription></Alert>}
  {loading&&<p role="status">Loading run history…</p>}
  {!loading&&!rows.length&&!error&&<p className="text-muted-foreground">No recorded runs yet.</p>}
  {rows.map(run=><Card role="article" key={run.id}><CardContent className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-3"><strong>{run.snapshot.name}</strong><Badge variant={outcomeVariant(run.outcome)}>{outcomeLabel(run.outcome)}</Badge></div><p className="mt-2 whitespace-pre-wrap break-words">{run.summary||'Run in progress.'}</p><p className="mt-2 text-sm text-muted-foreground">{run.startedAt===null?`Observed ${new Date(run.observedAt!).toLocaleString()}`:new Date(run.startedAt).toLocaleString()} · {run.trigger} · {run.delivery.kind==='none'?'No delivery recorded':run.delivery.kind+(run.delivery.destination?' · '+run.delivery.destination:'')}</p></div><Button variant="outline" id={`automation-run-${run.id}`} onClick={()=>{lastRun.current=run.id;if(onSelectRun)onSelectRun(run.id);else setSelected(run);}}>{run.recordKind==='diagnostic'?'Check details':'Run details'}</Button></CardContent></Card>)}
  {next&&<Button variant="outline" onClick={()=>controls.current.more()}>Load older runs</Button>}
  <Sheet open={controlled?!!runId:!!selected} onOpenChange={open=>{if(!open){if(onSelectRun)onSelectRun(undefined);else setSelected(undefined);}}}><SheetContent finalFocus={()=>lastRun.current?document.getElementById(`automation-run-${lastRun.current}`)??heading.current:heading.current} size="wide" className="overflow-y-auto p-5"><SheetHeader><SheetTitle>{selected?.snapshot.name??'Run details'}</SheetTitle><SheetDescription>Recorded scheduling, execution and delivery evidence.</SheetDescription></SheetHeader>{error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{loading&&!selected&&<p role="status">Loading run details…</p>}{selected&&<div className="mt-6 flex flex-col gap-5"><Badge variant={outcomeVariant(selected.outcome)}>{outcomeLabel(selected.outcome)}</Badge><p className="whitespace-pre-wrap break-words">{selected.snapshot.purpose}</p><dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3"><dt>Owner</dt><dd>{selected.snapshot.botId}</dd><dt>Trigger</dt><dd>{selected.trigger} · {selected.snapshot.triggerKind}{selected.event?' · '+selected.event:''}</dd><dt>Configuration</dt><dd className="break-words">{selected.snapshot.scheduleCron?`${selected.snapshot.scheduleCron} · ${selected.snapshot.tz}`:selected.snapshot.pollRepo?`${selected.snapshot.pollRepo} · every ${selected.snapshot.pollEveryMinutes} minutes`:'Event-driven'}{selected.snapshot.events?.length?` · events: ${selected.snapshot.events.join(', ')}`:''}</dd><dt>Permissions</dt><dd>{selected.snapshot.allowApprovals?'Normal action approvals':'Unattended read-only'}{selected.snapshot.roomId?'':selected.snapshot.allowTools?' · offline tools':' · no tools'}</dd>{selected.scheduledAt!==null&&<><dt>Scheduled</dt><dd>{new Date(selected.scheduledAt).toLocaleString()}{selected.gapUntil!==null?` through ${new Date(selected.gapUntil).toLocaleString()}`:''}</dd></>}{selected.observedAt!==null&&<><dt>Observed</dt><dd>{new Date(selected.observedAt).toLocaleString()}</dd></>}<dt>Started</dt><dd>{selected.startedAt===null?'Not started':new Date(selected.startedAt).toLocaleString()}</dd>{selected.reason&&<><dt>Reason</dt><dd>{reasonLabel(selected.reason)} · {selected.phase}</dd></>}<dt>{selected.recordKind==='diagnostic'?'Recorded':'Finished'}</dt><dd>{selected.endedAt?new Date(selected.endedAt).toLocaleString():'Still running'}</dd><dt>Delivery</dt><dd>{selected.delivery.kind}{selected.delivery.destination?' · '+selected.delivery.destination:''}</dd></dl><p className="whitespace-pre-wrap break-words">{selected.summary}</p>{selected.wakeDecisionId&&<p className="text-sm text-muted-foreground">Wake decision {selected.wakeDecisionId}. A ping records a desk message; device receipt is not confirmed.</p>}<nav className="flex flex-wrap gap-3">{selected.roomId&&<Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind:'room',roomId:selected.roomId})}/>}>Open conversation</Button>}{selected.workId&&<Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind:'work',workId:selected.workId})}/>}>Inspect Work & receipts</Button>}</nav>{selected.workId&&<ResultsPanel api={api} workId={selected.workId}/>}</div>}</SheetContent></Sheet>
 </section>;
}
