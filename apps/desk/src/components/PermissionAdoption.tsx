import {useCallback,useEffect,useRef,useState} from 'react';
import {messageOf,type Api} from '../api';
import type {PermissionAdoption as Adoption,PermissionPreset} from '../types';
import type {StreamListener} from '../stream';
import {Alert,AlertDescription,AlertTitle} from './ui/alert';
import {Badge} from './ui/badge';
import {Skeleton} from './ui/skeleton';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from './ui/table';
import {Disclosure} from './Disclosure';
import {Check,ShieldAlert} from 'lucide-react';
import {permissionModeIcons} from './PermissionControl';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {Field,FieldGroup,FieldLabel,FieldDescription,FieldSet,FieldLegend,FieldContent} from './ui/field';
import {ToggleGroup,ToggleGroupItem} from './ui/toggle-group';

export function PermissionAdoption({api,canManage,subscribe,onActiveChange}:{api:Api;canManage:boolean;subscribe?:(listener:StreamListener)=>()=>void;onActiveChange?:(active:boolean)=>void}){
  const sequence=useRef(0);
  const [review,setReview]=useState<Adoption|null>(null),[error,setError]=useState<string|null>(null),[checked,setChecked]=useState(false),[ack,setAck]=useState(false),[saving,setSaving]=useState(false),[preset,setPreset]=useState<PermissionPreset>('read-only');
  const refresh=useCallback(async()=>{const seq=++sequence.current;try{const next=await api.getPermissionAdoption();if(seq!==sequence.current)return;setReview(next);setChecked(false);setAck(false);}catch(e){if(seq===sequence.current)setError(messageOf(e));}},[api]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
  useEffect(()=>subscribe?.({onOpen:()=>{void refresh();},onEvent:e=>{if(e.type==='config'&&(e.payload as {action?:string}).action==='permission_adopted')void refresh();}}),[subscribe,refresh]);
  useEffect(()=>{onActiveChange?.(review?.active===true);},[review?.active,onActiveChange]);
  async function adopt(){if(!canManage||!checked||!review?.reviewVersion||saving)return;setSaving(true);setError(null);try{const next=await api.adoptPermissions(preset,review.reviewVersion,ack);sequence.current++;setReview(next);}catch(e){setError(messageOf(e));await refresh();}finally{setSaving(false);}}
  if(review?.active)return null;
  const modes:[PermissionPreset,string,string][]=[
    ['read-only','Read Only','No filesystem writes.'],
    ['workspace-write','Workspace Write','Write within your workspace.'],
    ['full-access','Full access','Unrestricted. No approval prompts.'],
  ];
  const removedRules=review?.legacyRules?.filter(rule=>!review.bots?.some(bot=>bot.id===rule.bot_id))??[];
  const rules=(entries:{tool_class:string;mode:string}[])=>entries.length?<div className="flex flex-wrap gap-2">{entries.map(rule=><Badge key={rule.tool_class} variant={rule.mode==='deny'?'destructive':'secondary'}>{rule.tool_class}: {rule.mode}</Badge>)}</div>:<span className="text-muted-foreground">Default rules</span>;
  return <section aria-label="Set up permission modes" className="flex min-w-0 flex-col gap-6">
    {!canManage?<Alert><AlertDescription>A Full device or owner must review and adopt permission modes.</AlertDescription></Alert>:review?.reviewVersion?<>
      <FieldGroup>
        <Field>
          <div className="flex items-center justify-between gap-3"><FieldLabel id="adoption-mode-label">Mode</FieldLabel><Badge variant="attention">Setup required</Badge></div>
          <ToggleGroup aria-label="Adoption permission mode" aria-labelledby="adoption-mode-label" variant="outline" spacing={3} className="grid w-full grid-cols-1 items-stretch sm:grid-cols-3" value={[preset]} disabled={saving} onValueChange={values=>{if(values[0]){setPreset(values[0] as PermissionPreset);setAck(false);}}}>
            {modes.map(([value,label,description])=>{const Icon=permissionModeIcons[value];return <ToggleGroupItem key={value} value={value} aria-label={label} className="h-auto min-w-0 flex-col items-start justify-start gap-2 whitespace-normal p-4 text-left transition-colors motion-reduce:transition-none">
              <span className="flex w-full items-center justify-between gap-2"><span className="flex items-center gap-2"><Icon aria-hidden="true" data-icon="inline-start"/>{label}</span><Check data-icon="inline-end" className="opacity-0 group-aria-pressed/toggle:opacity-100"/></span>
              <span className="text-xs font-normal leading-relaxed text-muted-foreground">{description}</span>
            </ToggleGroupItem>;})}
          </ToggleGroup>
        </Field>
        {preset==='full-access'&&<Alert variant="destructive"><ShieldAlert/><AlertTitle>Unrestricted access</AlertTitle><AlertDescription>Can access host credentials and cause destructive or remote changes without approval.</AlertDescription></Alert>}
        <Disclosure title="Details">
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>This mode replaces existing selections and becomes the future default. Extra write roots are cleared.</p>
            <p>Filesystem modes do not limit reads, network access or remote effects. Background and human-control limits still apply. Full access uses Never and refuses explicit review requests.</p>
            <p>Archived rules, approvals, receipts and Unknown outcomes are retained. Pending reviews expire; nothing is replayed.</p>
          </div>
      <Disclosure title={<>Previous rules <Badge variant="secondary">{review.legacyRules?.length??0} overrides</Badge></>}>
        <FieldGroup>
          <Field><FieldLabel>Previous defaults</FieldLabel>{rules(Object.entries(review.legacyDefaults??{}).map(([tool_class,mode])=>({tool_class,mode})))}<FieldDescription>External actions and secrets could not use Auto.</FieldDescription></Field>
          <Table aria-label="Previous agent rules"><TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Previous overrides</TableHead></TableRow></TableHeader><TableBody>
            {review.bots?.map(bot=><TableRow key={bot.id}><TableCell className="align-top whitespace-normal"><span>{bot.name}</span><span className="block text-xs text-muted-foreground">{bot.id}</span></TableCell><TableCell className="whitespace-normal">{rules(review.legacyRules?.filter(rule=>rule.bot_id===bot.id)??[])}</TableCell></TableRow>)}
            {removedRules.map(rule=><TableRow key={rule.bot_id+rule.tool_class}><TableCell className="whitespace-normal">{rule.bot_id} <span className="text-muted-foreground">(removed agent)</span></TableCell><TableCell>{rules([rule])}</TableCell></TableRow>)}
          </TableBody></Table>
        </FieldGroup>
      </Disclosure>
        </Disclosure>
        <FieldSet disabled={saving}>
          <FieldLegend className="sr-only">Confirm the replacement</FieldLegend>
          <FieldGroup>
            <Field orientation="horizontal" data-disabled={saving}><Checkbox id="permission-adoption-review" checked={checked} disabled={saving} aria-label="I reviewed the previous rules and accept replacing them, including denials" onCheckedChange={v=>setChecked(v===true)}/><FieldContent><FieldLabel htmlFor="permission-adoption-review">Replace previous rules, including denials.</FieldLabel></FieldContent></Field>
            {preset==='full-access'&&<Field orientation="horizontal" data-disabled={saving}><Checkbox id="permission-adoption-full" checked={ack} disabled={saving} aria-label="I acknowledge unconfined filesystem access, host-readable credentials and destructive or remote effects without individual prompts" onCheckedChange={v=>setAck(v===true)}/><FieldContent><FieldLabel htmlFor="permission-adoption-full">I accept the Full access risks.</FieldLabel></FieldContent></Field>}
          </FieldGroup>
        </FieldSet>
        <div className="flex flex-wrap items-center gap-3"><Button type="button" className="w-full sm:w-auto" disabled={!checked||saving||(preset==='full-access'&&!ack)} onClick={()=>void adopt()}>{saving?'Applying…':'Apply mode'}</Button></div>
      </FieldGroup>
    </>:<div role="status" aria-label="Loading previous permission rules" className="flex flex-col gap-3"><Skeleton className="h-10 w-full"/><Skeleton className="h-24 w-full"/><span className="sr-only">Loading the previous permission rules…</span></div>}
    {error&&<Alert variant="destructive"><AlertTitle>Could not update permission modes</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </section>;
}
