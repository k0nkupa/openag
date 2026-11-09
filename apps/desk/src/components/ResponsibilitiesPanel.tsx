import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Disclosure } from "./Disclosure";
import {useEffect,useState} from 'react';
import type {Api} from '../api';
import {messageOf} from '../api';
import type {Responsibility,ResponsibilityConfig,ResponsibilityList,Investigation,BotInfo,Room} from '../types';
import {useStream} from '../stream';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {SelectField,SelectItem} from './ui/select';
import {Field,FieldGroup,FieldLabel} from './ui/field';
import {SavedResultButton} from './ResultsPanel';

const empty:ResponsibilityConfig={name:'',botId:'',roomId:'',bindingId:'',resourceIds:[],sender:'',topic:'',question:''};
const label=(value:string)=>value.replaceAll('_',' ');
export function ResponsibilitiesPanel({api}:{api:Api}){
 const [data,setData]=useState<ResponsibilityList>(),[bots,setBots]=useState<BotInfo[]>([]),[rooms,setRooms]=useState<Room[]>([]),[error,setError]=useState<string>(),[busy,setBusy]=useState(false);
 const [refreshKey,setRefreshKey]=useState(0);
 const [form,setForm]=useState<ResponsibilityConfig>(),[editing,setEditing]=useState<Responsibility>(),[selected,setSelected]=useState<string>(),[history,setHistory]=useState<Investigation[]>([]);
 const {subscribe}=useStream();
 useEffect(()=>{let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
  async function load(){try{const [d,b,r]=await Promise.all([api.listResponsibilities(),api.listBots(),api.listRooms()]);const h=selected?await api.responsibilityHistory(selected):null;if(alive){setData(d);setBots(b.bots);setRooms(r.rooms);if(h)setHistory(h.investigations);setError(undefined);}}catch(e){if(alive)setError(messageOf(e));}}
  void load();const off=subscribe({onOpen:()=>void load(),onEvent:e=>{if(e.type==='config'&&typeof e.payload==='object'&&e.payload!==null&&'responsibilityId' in e.payload){clearTimeout(timer);timer=setTimeout(()=>void load(),350);}}});
  return()=>{alive=false;clearTimeout(timer);off();};
 },[api,subscribe,selected,refreshKey]);
 async function action(fn:()=>Promise<unknown>){setBusy(true);try{await fn();const d=await api.listResponsibilities();setData(d);if(selected)setHistory((await api.responsibilityHistory(selected)).investigations);setError(undefined);return true;}catch(e){setError(messageOf(e));return false;}finally{setBusy(false);}}
 const edit=(r?:Responsibility)=>{setEditing(r);setForm(r?{name:r.name,botId:r.botId,roomId:r.roomId,bindingId:r.bindingId,resourceIds:r.resourceIds,sender:r.sender,topic:r.topic,question:r.question}:{...empty,botId:bots.find(b=>b.runtime==='api')?.id??'',roomId:rooms[0]?.id??'',bindingId:data?.source.bindingId??'',resourceIds:data?.source.resourceIds.slice(0,1)??[]});};
 return <section className="mb-8 flex min-w-0 flex-col gap-4" aria-label="Standing responsibilities">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Standing responsibilities</h2><Button variant="outline" disabled={busy||!data?.source.bindingId} onClick={()=>edit()}>New responsibility</Button></div>
  <p className="text-muted-foreground">An approved responsibility investigates matching developments and prepares evidence with an unsent reply. It does not create Work or send messages to other people.</p>
  {data?.source.state==='source_unavailable'&&<p>No investigation source is connected. Outlook and other live sources are unavailable in this release. Controlled synthetic checks do not connect an account.</p>}
  {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  {form&&<form onSubmit={e=>{e.preventDefault();void action(()=>editing?api.updateResponsibility(editing.id,{...form,baseRevision:editing.revision,enabled:false}):api.createResponsibility(form)).then(ok=>{if(ok){setForm(undefined);setEditing(undefined);}});}}>
   <FieldGroup>
    {(['name','sender','topic','question'] as const).map(key=><Field key={key}><FieldLabel htmlFor={'responsibility-'+key}>{{name:'Name',sender:'Exact sender email',topic:'Subject topic words',question:'Question to investigate'}[key]}</FieldLabel><Input id={'responsibility-'+key} required type={key==='sender'?'email':'text'} maxLength={key==='question'?1000:key==='sender'?200:key==='name'?80:120} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>)}
    <Field><FieldLabel htmlFor="responsibility-bot">Investigator</FieldLabel><SelectField id="responsibility-bot" required value={form.botId} onValueChange={(value) =>setForm({...form,botId:value})}><SelectItem value="">Select an agent</SelectItem>{bots.map(b=><SelectItem key={b.id} value={b.id} disabled={b.runtime!=='api'}>{b.name} {b.runtime==='acp'?'(investigations unsupported)':''}</SelectItem>)}</SelectField></Field>
    <Field><FieldLabel htmlFor="responsibility-room">Result destination</FieldLabel><SelectField id="responsibility-room" required value={form.roomId} onValueChange={(value) =>setForm({...form,roomId:value})}>{rooms.map(r=><SelectItem key={r.id} value={r.id}>{r.name??r.id}</SelectItem>)}</SelectField></Field>
    <Field><FieldLabel htmlFor="responsibility-resource">Permitted source resource</FieldLabel><SelectField id="responsibility-resource" required value={form.resourceIds[0]??''} onValueChange={(value) =>setForm({...form,resourceIds:[value]})}>{data?.source.resourceIds.map(id=><SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectField><p className="text-sm text-muted-foreground">Source: {form.bindingId}. Read only. Other accounts and resources are excluded. Saving pauses the responsibility; review it before enabling.</p></Field>
    <div className="flex gap-3"><Button type="submit" disabled={busy}>Save paused responsibility</Button><Button type="button" variant="ghost" onClick={()=>setForm(undefined)}>Cancel</Button></div>
   </FieldGroup>
  </form>}
  {data?.responsibilities.map(r=><Card role="article" key={r.id}><CardContent className="flex min-w-0 flex-col gap-3">
   <strong>{r.name}</strong><p className="break-words">{r.question}</p><p className="break-words text-sm text-muted-foreground">{r.sender} · subject contains “{r.topic}” · {r.bindingId} / {r.resourceIds.join(', ')} · {r.enabled?'Enabled':'Paused'} · {label(r.readiness)}</p>
   <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy||(!r.enabled&&r.readiness!=='ready')} onClick={()=>void action(()=>api.updateResponsibility(r.id,{baseRevision:r.revision,enabled:!r.enabled}))}>{r.enabled?'Pause':'Enable reviewed responsibility'}</Button><Button variant="outline" disabled={busy} onClick={()=>edit(r)}>Edit and pause</Button><Button variant="ghost" onClick={()=>{setSelected(r.id);setHistory([]);setRefreshKey(key=>key+1);}}>Investigation history</Button></div>
  </CardContent></Card>)}
  {selected&&<div className="flex min-w-0 flex-col gap-3"><h3 className="font-semibold">Investigation history</h3><p className="text-muted-foreground">Findings are proposed source observations. Replies remain unsent. A desk notice does not confirm phone delivery.</p>{!history.length&&<p>No investigations recorded.</p>}{history.map(i=><Card role="article" key={i.id}><CardContent className="flex min-w-0 flex-col gap-3"><strong>{label(i.status)}</strong><p>{i.reason?label(i.reason):'Bounded investigation finished.'} · {new Date(i.createdAt).toLocaleString()} · delivery: {label(i.deliveryState)}</p>{i.sourceConflict&&<p>Source reported conflicting data for this event. The original observation was retained.</p>}{i.evidence.map(e=><Disclosure key={e.id} title={<> Evidence: {e.reference} · {new Date(e.observedAt).toLocaleString()} </>}> <p className="whitespace-pre-wrap break-words">{e.content}</p></Disclosure>)}{i.resultId&&<SavedResultButton api={api} id={i.resultId} version={1} name="Investigation findings and unsent reply"/>}</CardContent></Card>)}</div>}
 </section>;
}
