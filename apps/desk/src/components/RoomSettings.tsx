import { Check } from "lucide-react";
import { BotAvatar } from "./BotAvatar";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "./ui/command";
import { useUnsavedChanges } from "../unsaved-changes";
import { useEffect, useState } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { BotInfo, Room, RouterOption } from "../types";
import { RoomRouting } from "./RoomRoutingPanel";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { SelectField, SelectItem } from "./ui/select";
import { Textarea } from "./ui/textarea";

const errorMessage = (e: unknown) => e instanceof ApiError && e.status === 403 ? "Only the owner can change room settings." : messageOf(e);

function RoomDetails({ api, room, bots, onSaved }: { api: Api; room: Room; bots: BotInfo[]; onSaved: (room: Room) => void }) {
  const [name, setName] = useState(room.name), [description, setDescription] = useState(room.description ?? ""), [lead, setLead] = useState(room.leadBotId ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const additions = selected.filter(id => !room.members.includes(id));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  useEffect(() => { setName(room.name); setDescription(room.description ?? ""); setLead(room.leadBotId ?? ""); }, [room.name, room.description, room.leadBotId]);
  const patch = {
    ...(name.trim() !== room.name ? { name: name.trim() } : {}),
    ...(description.trim() !== (room.description ?? "") ? { description: description.trim() } : {}),
    ...(lead && lead !== room.leadBotId ? { leadBotId: lead } : {}),
    ...(additions.length ? { addMembers: additions } : {}),
  };
  const dirty = Object.keys(patch).length > 0;
  useUnsavedChanges(dirty, busy);
  async function save() {
    setBusy(true); setError(""); setStatus("");
    try { const { room: saved } = await api.updateRoom(room.id, patch); if (additions.some(id => !saved.members.includes(id))) throw new Error("Could not confirm the added agents. Check room settings before saving again."); onSaved(saved); setSelected([]); setStatus("Saved."); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const members = room.members.map(id => ({ id, name: bots.find(b => b.id === id)?.name ?? id }));
  return <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); if (dirty && name.trim() && !busy) void save(); }}>
    <FieldGroup><Field><FieldLabel htmlFor={`room-name-${room.id}`}>Room name</FieldLabel><Input id={`room-name-${room.id}`} value={name} maxLength={80} disabled={busy} onChange={e => { setName(e.target.value); setStatus(""); }} /></Field>
    <Field><FieldLabel htmlFor={`room-desc-${room.id}`}>Description</FieldLabel><Textarea id={`room-desc-${room.id}`} value={description} maxLength={500} rows={3} disabled={busy} placeholder="What is this room for?" onChange={e => { setDescription(e.target.value); setStatus(""); }} /></Field>
    <Field><FieldLabel htmlFor={`room-lead-${room.id}`}>Lead</FieldLabel>
      <SelectField id={`room-lead-${room.id}`} value={lead} disabled={busy || members.length === 0} onValueChange={(value) => { setLead(value); setStatus(""); }}>
        {!room.leadBotId && <SelectItem value="">No lead</SelectItem>}
        {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectField>
      <FieldDescription>Answers messages that have no @mention, unless routing below picks someone else. Only room members can lead.</FieldDescription>
    </Field>
    {room.kind !== "direct" && <Field><FieldLabel>Add agents{additions.length ? ` · ${additions.length} selected` : ""}</FieldLabel>
      <Command><CommandInput aria-label="Search agents to add" placeholder="Search agents…" disabled={busy} /><CommandList aria-label="Room agents" className="h-60 max-h-60 overflow-y-auto"><CommandEmpty>No agents found.</CommandEmpty><CommandGroup>{bots.map(bot => {
        const member = room.members.includes(bot.id), checked = member || additions.includes(bot.id);
        return <CommandItem key={bot.id} value={bot.id} keywords={[bot.name]} disabled={busy || member || !checked && room.members.length + additions.length >= 50} aria-label={`${member ? "Already in room:" : checked ? "Deselect" : "Add"} ${bot.name} @${bot.id}`} onSelect={() => { setSelected(checked ? selected.filter(id => id !== bot.id) : [...selected, bot.id]); setStatus(""); }}><BotAvatar name={bot.id} avatar={bot.avatar} size={24} /><span className="flex-1 truncate">{bot.name} <span className="text-muted-foreground">@{bot.id}</span></span>{checked && <Check aria-hidden="true" />}</CommandItem>;
      })}</CommandGroup></CommandList></Command>
    </Field>}
    </FieldGroup>
    <div className="flex gap-2"><Button type="submit" disabled={busy || !dirty || !name.trim()}>Save room details</Button></div>
    {status && <FieldDescription role="status">{status}</FieldDescription>}<FieldError>{error}</FieldError>
  </form>;
}

export function RoomSettings({ api, room, bots }: { api: Api; room: Room; bots: BotInfo[] }) {
  const [current, setCurrent] = useState(room);
  const [options, setOptions] = useState<RouterOption[] | null>(null), [optionsError, setOptionsError] = useState("");
  useEffect(() => setCurrent(room), [room]);
  useEffect(() => {
    let cancelled = false;
    void api.getRouterStrategies().then(o => { if (!cancelled) { setOptions(o.strategies); setOptionsError(""); } }, e => { if (!cancelled) setOptionsError(messageOf(e)); });
    return () => { cancelled = true; };
  }, [api]);
  return <div className="flex min-w-0 flex-col gap-4">
    <RoomDetails api={api} room={current} bots={bots} onSaved={setCurrent} />
    <Separator />
    <section className="flex flex-col gap-3" aria-label="Routing">
      <h3 className="text-sm font-medium">Routing</h3>
      <FieldDescription>Messages without an @mention go to the lead unless routing is enabled. Routing sends redacted message text (first 1000 characters) to the chosen provider. If routing fails, the lead answers.</FieldDescription>
      <FieldError>{optionsError && `Could not load routing options: ${optionsError}`}</FieldError>
      {options ? <RoomRouting hideHeader api={api} room={current} options={options} disabled={false} onSaved={setCurrent} /> : !optionsError && <p>Checking…</p>}
    </section>
  </div>;
}
