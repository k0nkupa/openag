import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { BotModelSettings } from "./BotModelSettings";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { messageOf, type Api } from "../api";
import { type Avatar, type BotInfo, type BotSettings } from "../types";
import { BotAvatar } from "./BotAvatar";
import { BookOpen, BrainCircuit, FileText, Pencil } from "lucide-react";
import { BotSettingRow, BotSettingsNavigation } from "./BotSettingRow";
import { AvatarEditor } from "./AvatarEditor";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";

const MONO = "font-mono text-[12px] leading-[18px] text-muted-foreground";
const ERROR = "mt-1.5 mb-0 text-destructive";
const NOTICE = "mb-2 mt-0 text-[var(--warn)] [overflow-wrap:anywhere]";
const GROUP_HEAD = "m-0 flex items-center gap-2 text-sm font-normal text-muted-foreground";
const OWNER_REQUIRED = "owner token required";
export function BotEditor({ api, bot, onSaved, children }: { api: Api; bot: BotInfo; onSaved: () => void; children?: ReactNode }) {
  const inlineSettings = useContext(BotSettingsNavigation) !== null;
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description ?? "");
  const [maxSteps,setMaxSteps]=useState(20);
  const [instructions, setInstructions] = useState("");
  const [avatar, setAvatar] = useState<Avatar | null>(bot.avatar ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saving = useRef(false);
  const saveVersion = useRef(0);
  useEffect(() => () => { saveVersion.current++; }, [api, bot.id]);
  const avatarVersion = useRef(0);
  useEffect(() => { avatarVersion.current++; setAvatar(bot.avatar ?? null); }, [bot.id, bot.avatar]);

  useEffect(() => {
    let cancelled = false;
    const requestedAvatarVersion = avatarVersion.current;
    setSettings(null);
    setLocked(false);
    setLoadError(null);
    setName(bot.name);
    setDescription(bot.description ?? "");
    setInstructions("");
    setAvatar(bot.avatar ?? null);
    setOpen(false);
    setError(null);
    setSaved(false);
    api.getBotSettings(bot.id).then(
      (s) => {
        if (cancelled) return;
        setSettings(s);
        setName(s.name);
        setDescription(s.description);
        setInstructions(s.instructions);setMaxSteps(s.maxSteps??20);
        if (requestedAvatarVersion === avatarVersion.current) setAvatar(s.avatar);
      },
      (err: unknown) => {
        if (cancelled) return;
        const m = messageOf(err);
        if (m.includes(OWNER_REQUIRED)) setLocked(true);
        else setLoadError(m);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, bot.id]);

  const dirty = settings !== null &&
    (name !== settings.name || description !== settings.description || instructions !== settings.instructions || maxSteps !== (settings.maxSteps??20));

  useUnsavedChanges(dirty, busy);

  async function saveAvatar(value: Avatar | null) {
    setBusy(true);
    try {
      await api.putBotSettings(bot.id, { avatar: value });
      setAvatar(value);
      setSettings(s => s ? { ...s, avatar: value } : s);
      onSaved();
    } finally { setBusy(false); }
  }

  function discard() {
    setName(settings?.name ?? bot.name);
    setDescription(settings?.description ?? bot.description ?? "");
    setInstructions(settings?.instructions ?? "");setMaxSteps(settings?.maxSteps??20);
    setError(null);
  }

  async function save() {
    if (saving.current || !settings) return;
    saving.current = true;
    const version = saveVersion.current;
    setBusy(true);
    setError(null);
    setSaved(false);
    const patch: Parameters<Api["putBotSettings"]>[1] = {};
    if (settings) {
      if (name !== settings.name) patch.name = name;
      if (description !== settings.description) patch.description = description;
      if(maxSteps!==(settings.maxSteps??20))patch.maxSteps=maxSteps;
      if (instructions !== settings.instructions) patch.instructions = instructions;
    }
    try {
      await api.putBotSettings(bot.id, patch);
      const fresh = await api.getBotSettings(bot.id);
      if (version !== saveVersion.current) return;
      if (Object.entries(patch).some(([field, value]) => fresh[field as keyof BotSettings] !== value)) throw new Error("The server returned different values. Reload to review them before retrying.");
      setSettings(fresh);
      setName(fresh.name);
      setDescription(fresh.description);
      setInstructions(fresh.instructions);setMaxSteps(fresh.maxSteps??20);
      setSaved(true);
      onSaved();
    } catch (err) {
      if (version === saveVersion.current) setError(`Save was not confirmed. Your draft is kept. ${messageOf(err)}`);
    } finally {
      saving.current = false;
      if (version === saveVersion.current) setBusy(false);
    }
  }

  return (
    <section className="mb-3 flex min-w-0 flex-col gap-4" aria-label={`Settings for ${bot.name}`}>
      {error && <Alert variant="destructive" className={ERROR}><AlertDescription>{error}</AlertDescription></Alert>}
      {loadError && <Alert variant="destructive" className={ERROR}><AlertDescription>Could not load settings: {loadError}</AlertDescription></Alert>}
      {locked && (
        <p className={NOTICE} role="status">
          Name, description and instructions are owner-only. This device has limited access. Ask a trusted Full access device to change this device in Settings, Devices, or run pnpm desk:open on the daemon host. You can still change the avatar.
        </p>
      )}

      <div className="relative flex items-center gap-4">
        <Dialog open={open} disablePointerDismissal onOpenChange={next => { if (!busy) setOpen(next); }}>
          <DialogTrigger render={<Button variant="ghost" className="relative h-16 w-16 overflow-visible rounded-[16px] p-0" disabled={busy || (!settings && !locked)} aria-label="Change avatar" />}>
            <BotAvatar name={bot.id} size={56} avatar={avatar} /><span className="absolute -right-px bottom-0 flex size-[21px] items-center justify-center rounded-full border-2 border-background bg-secondary [&_svg]:!size-2.5"><Pencil data-icon="inline-end" /></span>
          </DialogTrigger>
          <DialogContent className="w-[min(760px,calc(100vw-32px))] max-w-[760px] gap-6 overflow-auto p-6 max-h-[calc(100dvh-32px)] sm:max-w-[760px] max-[600px]:gap-[18px] max-[600px]:p-5" showCloseButton={false}>{open && <AvatarEditor id={bot.id} name={bot.name} avatar={avatar} onSave={saveAvatar} close={() => setOpen(false)} />}</DialogContent>
        </Dialog>
        <div>
          <div className="flex flex-wrap items-center gap-2"><div className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">{name}</div>{bot.isDefault && <Badge variant="secondary">Default</Badge>}</div>
          <div className={MONO}>
            {bot.adapter ? `${bot.adapter} · ` : ""}
            {bot.runtime} · @{bot.id}
          </div>
        </div>
      </div>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="bname">Name</FieldLabel>
          <Input id="bname" type="text" value={name} disabled={busy || locked || !settings} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field className="col-span-full">
          <FieldLabel htmlFor="bdesc">Description</FieldLabel>
          <Input id="bdesc" type="text" value={description} disabled={busy || locked || !settings} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {bot.runtime==='api'&&<Field><FieldLabel htmlFor="bstep">Maximum model steps</FieldLabel><Input id="bstep" type="number" min={1} max={100} step={1} value={maxSteps} disabled={busy||locked||!settings} onChange={e=>setMaxSteps(Number(e.target.value))}/><p className={MONO}>Per turn. Tool execution is separately limited to 40 calls.</p></Field>}
      </FieldGroup>
      <section className="mt-6 flex flex-col gap-2.5" aria-label="Brain">
        <h3 className={GROUP_HEAD}><BrainCircuit aria-hidden="true" className="size-4 shrink-0" />Brain</h3>
        <Card className="gap-0 py-0"><CardContent className="px-0">
          <BotModelSettings key={bot.id} api={api} bot={bot} onSaved={onSaved} />
        </CardContent></Card>
      </section>
      <section className="mt-6 flex flex-col gap-2.5" aria-label="Knows">
        <h3 className={GROUP_HEAD}><BookOpen aria-hidden="true" className="size-4 shrink-0" />Knows</h3>
        <Card className="gap-0 py-0"><CardContent className="px-0">
          <BotSettingRow title="Instructions" icon={FileText}>
        <Field className="col-span-full">
          <FieldLabel htmlFor="binstr">Instructions</FieldLabel>
          <Textarea id="binstr" rows={5} value={instructions} disabled={busy || locked || !settings} maxLength={8000} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
            {!inlineSettings && <>
            {error && <Alert variant="destructive" className={ERROR}><AlertDescription>{error}</AlertDescription></Alert>}
            {saved && !dirty && <p role="status">Saved</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty || busy} onClick={discard}>Discard</Button>
              <Button disabled={!dirty || busy} onClick={() => void save()}>Save</Button>
            </div>
            </>}
          </BotSettingRow>
          {children}
        </CardContent></Card>
      </section>
      {(dirty || saved) && <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
        <span className="grow" />
        {saved && !dirty && <span className={MONO} role="status">Saved</span>}
        <Button variant="outline" type="button" disabled={!dirty || busy} onClick={discard}>Discard</Button>
        <Button type="button" disabled={!dirty || busy} onClick={() => void save()}>{inlineSettings ? "Save agent settings" : "Save"}</Button>
      </footer>}
    </section>
  );
}
