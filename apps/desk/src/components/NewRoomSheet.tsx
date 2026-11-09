import { BotAvatar } from "./BotAvatar";
import { Dialog } from "@base-ui/react/dialog";
import { Check, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, messageOf, type Api, type Whoami } from "../api";
import type { BotInfo, Room } from "../types";
import { newCreationRequestId } from "../lib/creationRequestId";
import { getOwnerToken } from "../ownerSession";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { SelectField, SelectItem } from "./ui/select";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "./ui/command";
import { Alert, AlertDescription } from "./ui/alert";

const CreationAccess = createContext<{ allowed: boolean; handle: ReturnType<typeof Dialog.createHandle> } | null>(null);
export function NewRoomTrigger({ onClick }: { onClick?: () => void }) {
  const creation = useContext(CreationAccess);
  if (!creation) return null;
  return <SheetTrigger handle={creation.handle} onClick={onClick} render={<Button type="button" variant="ghost" size="icon-sm" disabled={!creation.allowed} aria-label="New room" title={creation.allowed ? "New room" : "Full access is required to create a room"} />}><Plus aria-hidden="true" /></SheetTrigger>;
}

type Draft = { requestId: string; id: string; name: string; members: string[]; lead: string };
export function NewRoomSheet({ api, identity, bots, onCreated, children }: { api: Api; identity: Whoami | null; bots: BotInfo[]; onCreated: (room: Room) => void; children: ReactNode }) {
  const [handle] = useState(() => Dialog.createHandle());
  const [open, setOpen] = useState(false), [triggerId, setTriggerId] = useState<string | null>(null);
  const [name, setName] = useState(""), [members, setMembers] = useState<string[]>([]), [lead, setLead] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const [recorded, setRecorded] = useState<Room | null>(null);
  const requestId = useRef(newCreationRequestId()), submitted = useRef<Draft | null>(null), inFlight = useRef(false), version = useRef(0);
  useEffect(() => {
    version.current++;
    if (inFlight.current) {
      inFlight.current = false; setBusy(false); setUncertain(true);
      setError("Connection changed while creation was pending. Your draft is kept. Check creation status before retrying.");
    }
    return () => { version.current++; };
  }, [api]);
  const allowed = identity?.kind === "owner" || identity?.kind === "device" && identity.access === "full" || getOwnerToken() !== null;
  const disabled = busy || uncertain || !!recorded || !allowed;
  const valid = !!name.trim() && members.length > 0 && members.length <= 50 && members.includes(lead) && members.every(id => bots.some(bot => bot.id === id));
  function complete(room: Room) {
    setOpen(false); setName(""); setMembers([]); setLead(""); setError(""); setUncertain(false); setRecorded(null); submitted.current = null; requestId.current = newCreationRequestId(); onCreated(room);
  }
  function finish(room: Room, draft: Draft) {
    if (room.id !== draft.id || room.kind !== "room" || room.name !== draft.name.trim() || room.leadBotId !== draft.lead || JSON.stringify([...room.members].sort()) !== JSON.stringify([...draft.members].sort())) {
      setRecorded(room); setUncertain(false); setError("Creation was recorded, but the saved room differs from your draft. The name may have been redacted, or the room edited. Review the saved room below before opening it."); return;
    }
    complete(room);
  }
  async function checkStatus() {
    if (inFlight.current || !submitted.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current, draft = submitted.current;
    try {
      const { room } = await api.roomCreationStatus(draft.requestId);
      if (current !== version.current) return;
      if (room) finish(room, draft); else { setUncertain(false); setError("No creation was recorded. Your draft is kept; you can try again."); }
    } catch (e) { if (current === version.current) { setUncertain(true); setError(`Creation is still uncertain. ${messageOf(e)}`); } }
    finally { if (current === version.current) { inFlight.current = false; setBusy(false); } }
  }
  async function create() {
    if (inFlight.current || disabled || !valid) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current;
    const draft = { requestId: requestId.current, id: `room-${requestId.current}`, name, members: [...members], lead };
    submitted.current = draft;
    try {
      const { room } = await api.createRoom({ ...draft, kind: "room" });
      if (current === version.current) finish(room, draft);
    } catch (e) {
      if (current !== version.current) return;
      if (e instanceof ApiError && [400, 401, 403].includes(e.status)) { setError(`${messageOf(e)} Your draft is kept.`); return; }
      try {
        const { room } = await api.roomCreationStatus(draft.requestId);
        if (current !== version.current) return;
        if (room) finish(room, draft); else setError(`${messageOf(e)} No creation was recorded. Your draft is kept.`);
      } catch { if (current === version.current) { setUncertain(true); setError("Creation is uncertain. Your draft is kept. Check creation status before retrying."); } }
    } finally { if (current === version.current) { inFlight.current = false; setBusy(false); } }
  }
  function toggle(id: string) {
    if (members.includes(id)) { setMembers(members.filter(member => member !== id)); if (lead === id) setLead(""); }
    else if (members.length < 50) { setMembers([...members, id]); if (!members.length) setLead(id); }
  }
  return <CreationAccess.Provider value={{ allowed, handle }}>{children}
    <Sheet handle={handle} triggerId={triggerId} open={open} onOpenChange={(next, details) => { if (!busy) { setOpen(next); setTriggerId(details.trigger?.id ?? null); } }}>
      <SheetContent finalFocus={() => document.getElementById(triggerId ?? "") ?? document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')} className="overflow-y-auto">
        <SheetHeader><SheetTitle>New room</SheetTitle><SheetDescription>Choose agents and a lead for a separate conversation. Creating a room starts no agent turn or Work.</SheetDescription></SheetHeader>
        <form className="flex flex-col gap-5 p-4" onSubmit={e => { e.preventDefault(); void create(); }}>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {recorded && <><p className="text-sm">Saved room: {recorded.name}. Lead: @{recorded.leadBotId}. Agents: {recorded.members.map(id => `@${id}`).join(", ")}.</p><Button type="button" disabled={busy || !allowed} onClick={() => complete(recorded)}>Open recorded room</Button></>}
          {uncertain && <Button type="button" disabled={busy || !allowed} onClick={() => void checkStatus()}>Check creation status</Button>}
          <FieldGroup>
            <Field><FieldLabel htmlFor="new-room-name">Room name</FieldLabel><Input id="new-room-name" required maxLength={80} value={name} disabled={disabled} onChange={e => setName(e.target.value)} /><p className="text-sm text-muted-foreground">Names may repeat. Each room has a separate identity.</p></Field>
            <Field><FieldLabel>Agents · {members.length} selected</FieldLabel>
              <Command><CommandInput aria-label="Search agents" placeholder="Search agents…" disabled={disabled} /><CommandList aria-label="Room agents" className="h-60 max-h-60 overflow-y-auto"><CommandEmpty>No agents found.</CommandEmpty><CommandGroup>{bots.map(bot => <CommandItem key={bot.id} value={bot.id} keywords={[bot.name]} disabled={disabled || !members.includes(bot.id) && members.length >= 50} aria-label={`${members.includes(bot.id) ? "Remove" : "Add"} ${bot.name} @${bot.id}`} onSelect={() => toggle(bot.id)}><BotAvatar name={bot.id} avatar={bot.avatar} size={24} /><span className="flex-1 truncate">{bot.name} <span className="text-muted-foreground">@{bot.id}</span></span>{members.includes(bot.id) && <Check aria-hidden="true" />}</CommandItem>)}</CommandGroup></CommandList></Command>
              {!bots.length && <p className="text-sm text-muted-foreground">Create an agent in Bots first.</p>}
            </Field>
            <Field><FieldLabel htmlFor="new-room-lead">Lead</FieldLabel><SelectField id="new-room-lead" value={lead} disabled={disabled || !members.length} onValueChange={(value) => setLead(value)}><SelectItem value="">Choose a lead</SelectItem>{members.map(id => <SelectItem key={id} value={id}>{bots.find(bot => bot.id === id)?.name ?? id} @{id}</SelectItem>)}</SelectField><p className="text-sm text-muted-foreground">The lead answers by default. Mentions and configured routing take priority.</p></Field>
          </FieldGroup>
          <Button type="submit" disabled={disabled || !valid}>{busy ? "Working…" : "Create room"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  </CreationAccess.Provider>;
}
