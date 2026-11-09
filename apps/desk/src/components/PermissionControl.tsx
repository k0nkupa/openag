import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ApiError, messageOf, type Api } from '../api';
import type { PermissionSelection, PermissionPreset, BotInfo } from '../types';
import type { StreamListener } from '../stream';
import { Button } from './ui/button';
import { ChevronDown } from 'lucide-react';
import { IconEye, IconShield, IconShieldCode, IconShieldExclamation } from '@tabler/icons-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field';
import { SelectField, SelectItem } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';

const labels:Record<PermissionPreset,string>={'read-only':'Read Only','workspace-write':'Workspace Write','full-access':'Full access'};
export const permissionModeIcons = { 'read-only': IconEye, 'workspace-write': IconShieldCode, 'full-access': IconShieldExclamation };
export interface PermissionControlHandle { open():void }
export const PermissionControl=forwardRef<PermissionControlHandle,{api:Api;roomId?:string;bots?:readonly BotInfo[];initialBotId?:string;canManage:boolean;showTrigger?:boolean;subscribe?:(listener:StreamListener)=>()=>void}>(function PermissionControl({api,roomId,bots=[],initialBotId,canManage,showTrigger=true,subscribe},ref){
  const [botId,setBotId]=useState(initialBotId??bots[0]?.id??'');
  const resetDraft=useRef(true),[draftScope,setDraftScope]=useState<string|null>(null);
  const [value,setValue]=useState<PermissionSelection|null>(null),[draft,setDraft]=useState<PermissionPreset>('workspace-write'),[draftRevision,setDraftRevision]=useState(0);
  const [open,setOpen]=useState(false),[ack,setAck]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),[available,setAvailable]=useState(true);
  const sequence=useRef(0),opened=useRef(false);opened.current=open;
  const scope=JSON.stringify([roomId,botId]),currentScope=useRef(scope);currentScope.current=scope;
  useEffect(()=>{setBotId(initialBotId??bots[0]?.id??'');},[initialBotId,roomId]);
  const refresh=useCallback(async(reset=false)=>{
    if(reset){resetDraft.current=true;setDraftScope(null);}
    const seq=++sequence.current;
    try{const next=roomId?await api.getPermissions(botId,roomId):await api.getPermissionDefault();if(seq!==sequence.current)return;setAvailable(true);setValue(next);if(resetDraft.current||!opened.current){setDraft(next.preset);setDraftRevision(next.revision);setAck(false);setDraftScope(scope);resetDraft.current=false;} }
    catch(e){if(seq!==sequence.current)return;if(e instanceof ApiError&&e.status===404)setAvailable(false);else setError(messageOf(e));}
  },[api,roomId,botId,scope]);
  useEffect(()=>{setValue(null);void refresh(true);return()=>{sequence.current++;};},[refresh]);
  useEffect(()=>subscribe?.({onOpen:()=>{void refresh();},onEvent:event=>{if(event.type==='config'&&String((event.payload as {action?:string}).action??'').startsWith('permission_'))void refresh();}}),[subscribe,refresh]);
  function show(){setError(null);setOpen(true);void refresh(true);}
  useImperativeHandle(ref,()=>({open:show}));
  async function save(){
    if(!value||value.adoptionRequired||draftScope!==scope||!canManage||saving)return;
    const revision=draftRevision,selectedScope=scope;setSaving(true);setError(null);
    try{const next=roomId?await api.setPermissions(botId,roomId,draft,revision,ack):await api.setPermissionDefault(draft,revision,ack);if(selectedScope===currentScope.current){setValue(current=>current&&current.revision>next.revision?current:next);setOpen(false);void refresh();}}
    catch(e){if(selectedScope===currentScope.current){setError(messageOf(e));if(e instanceof ApiError&&e.status===409)void refresh(true);}}
    finally{setSaving(false);}
  }
  const ModeIcon = value && !value.adoptionRequired ? permissionModeIcons[value.preset] : IconShield;
  if(!available)return null;
  return <>
    {showTrigger&&<Button type="button" variant={roomId?"ghost":"outline"} size={roomId?"sm":"default"} onClick={show} aria-label={roomId?'Session permissions':'Default permissions'}><ModeIcon aria-hidden="true" data-icon="inline-start"/>{roomId?`${bots.find(b=>b.id===botId)?.name??'Agent'} · `:''}{value?.adoptionRequired?'Adoption required':value?labels[value.preset]:'Permissions'}{!roomId&&<ChevronDown data-icon="inline-end"/>}</Button>}
    <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{roomId?'Session permissions':'Default permissions'}</DialogTitle><DialogDescription>{roomId?'Applies to the selected agent in this conversation.':'Applies only to future sessions. Existing sessions keep their selection.'}</DialogDescription></DialogHeader>
      <FieldGroup>
        {value?.adoptionRequired&&<Alert><AlertDescription>Tool execution awaits owner adoption. Review previous rules in Server settings before selecting session modes.</AlertDescription></Alert>}
        {roomId&&bots.length>1&&<Field><FieldLabel htmlFor="permission-agent">Agent</FieldLabel><SelectField id="permission-agent" value={botId} disabled={saving} onValueChange={value=>{setBotId(value);setAck(false);}}>{bots.map(bot=><SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>)}</SelectField></Field>}
        <Field><FieldLabel>Permission mode</FieldLabel><ToggleGroup aria-label="Permission mode" variant="outline" orientation="vertical" value={[draft]} disabled={!canManage||saving||!value||value.adoptionRequired||draftScope!==scope} onValueChange={values=>{if(values[0]){setDraft(values[0] as PermissionPreset);setAck(false);}}}>{Object.entries(labels).map(([preset,label])=>{const Icon=permissionModeIcons[preset as PermissionPreset];return <ToggleGroupItem key={preset} value={preset}><Icon aria-hidden="true" data-icon="inline-start"/>{label}</ToggleGroupItem>;})}</ToggleGroup>
          <FieldDescription>Read Only and Workspace Write use Ask for explicit exceptions. Full access uses Never: explicit review requests are refused.</FieldDescription>
        </Field>
        <p className="text-sm text-muted-foreground">Filesystem modes limit writes. They do not isolate reads, network access or remote account effects. Opaque MCP, Apps and computer input require interactive Full access. Offline, background and human-control limits still apply.</p>
        {roomId&&value&&'support' in value&&<div className="flex flex-col gap-2 text-sm"><div><Badge variant={value.support.hostConfinement?'success':'attention'}>{value.support.hostConfinement?'Host confinement available':'Host confinement unavailable'}</Badge></div><p className="break-all">Workspace: {value.workspace??'Bound on first use'}</p>{value.writeRoots.length>0&&<p className="break-all">Extra write roots: {value.writeRoots.join(', ')}</p>}<p>Revision {value.revision}. Changing mode cancels supported active execution and expires pending reviews. It cannot undo effects or resolve Unknown receipts.</p></div>}
        {draft==='full-access'&&<p className="text-sm text-muted-foreground">Full access runs commands without filesystem confinement. Commands may read host-readable credentials.</p>}
        {draft==='full-access'&&<Field orientation="horizontal"><Checkbox id="permission-full-ack" aria-labelledby="permission-full-label" checked={ack} disabled={!canManage||saving} onCheckedChange={checked=>setAck(checked===true)} /><FieldLabel id="permission-full-label" htmlFor="permission-full-ack">I understand that commands and connected tools can cause destructive or remote effects without individual prompts.</FieldLabel></Field>}
        {!canManage&&<p className="text-sm">A Full device or the owner must change permissions.</p>}
        {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={()=>setOpen(false)}>Cancel</Button><Button type="button" disabled={!canManage||saving||!value||value.adoptionRequired||draftScope!==scope||(draft==='full-access'&&!ack)} onClick={()=>void save()}>{saving?'Saving…':'Save permissions'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
});
