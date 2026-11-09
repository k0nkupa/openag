import { useAvatarLibrary } from "../avatar-library";
import { useRef, useState } from "react";
import { RotateCcw, Shuffle } from "lucide-react";
import { messageOf } from "../api";
import { AVATAR_COLORS, AVATAR_SHAPES, type Avatar } from "../types";
import { BotAvatar, type AvatarMood } from "./BotAvatar";
import { avatarCharacter, avatarColors, avatarDefinition, avatarFor } from "./avatar-catalogue";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const OPTION_INPUT = "peer absolute inset-0 size-full cursor-pointer opacity-0";
const OPTION_FOCUS = "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[color:var(--ring)]";
const COLOR_SPAN = `flex size-[26px] items-center justify-center rounded-full pointer-events-none peer-checked:outline-1 peer-checked:outline-offset-[3px] peer-checked:outline-[color:var(--foreground)] ${OPTION_FOCUS}`;

export function AvatarEditor({ id, name, avatar, onSave, close }: {
  id: string; name: string; avatar?: Avatar | null; onSave: (avatar: Avatar | null) => Promise<void>; close: () => void;
}) {
  const library = useAvatarLibrary();
  const choices = [...AVATAR_SHAPES.map(shape => ({ id: shape, name: avatarDefinition(shape).name })), ...library.avatars.map(item => ({ id: item.id, name: item.definition.name }))];
  const auto = avatarFor(id);
  const [draft, setDraft] = useState<Avatar | null>(avatar ?? null);
  const shown: Avatar = { ...(draft ?? { color: null }), shape: choices.find(choice => choice.id === draft?.shape)?.id ?? avatarCharacter(draft?.shape, id) };
  const animated = shown.animated ?? true;
  const [mood, setMood] = useState<AvatarMood>("idle");
  const [view, setView] = useState<[number, number]>([-8, 0]);
  const [gaze, setGaze] = useState<[number, number]>([0, 0]);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const blocked = busy || library.loading || !!library.error;
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const drag = useRef<{ x: number; y: number; view: [number, number] } | null>(null);
  const change = (patch: Partial<Avatar>) => setDraft({ ...shown, ...patch });
  const resetView = () => { setView([-8, 0]); setGaze([0, 0]); };
  const canMove = () => animated && !busy && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function save() {
    if (saving.current || blocked) return;
    saving.current = true; setBusy(true); setError(undefined);
    try { await onSave(draft); close(); }
    catch (err) { setError(messageOf(err)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <>
    <DialogHeader><DialogTitle>{name}’s avatar</DialogTitle><DialogDescription>Give your agent a familiar face.</DialogDescription></DialogHeader>
    {library.error && <Alert variant="destructive"><AlertDescription>Could not load the avatar library. Reload the desk to try again.</AlertDescription></Alert>}
    {library.loading && <p role="status">Loading avatar library…</p>}
    {error && <Alert variant="destructive"><AlertDescription>Could not save avatar: {error}</AlertDescription></Alert>}
    <div className="grid grid-cols-[.9fr_1.1fr] gap-8 max-[600px]:grid-cols-1 max-[600px]:gap-6">
      <div className="flex min-w-0 flex-col items-center justify-center gap-4 rounded-[16px] bg-muted px-3 py-[18px] max-[600px]:gap-2 max-[600px]:pt-1 max-[600px]:pb-3.5">
        <div className="flex h-[220px] w-full cursor-grab touch-none items-center justify-center rounded-[12px] [perspective:700px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] active:cursor-grabbing max-[600px]:h-[180px] max-[600px]:[&_[data-bot]]:!size-[140px]" role="group" tabIndex={0} aria-label="Avatar view. Drag or use arrow keys to turn. Home resets the view."
          onPointerDown={e => { if (!canMove()) return; drag.current = { x: e.clientX, y: e.clientY, view }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerMove={e => {
            if (!canMove()) return;
            if (drag.current) {
              const start = drag.current;
              setView([Math.max(-35, Math.min(35, start.view[0] - (e.clientY - start.y) * .3)), Math.max(-65, Math.min(65, start.view[1] + (e.clientX - start.x) * .4))]);
            } else if (follow && e.pointerType === "mouse") {
              const bounds = e.currentTarget.getBoundingClientRect();
              setGaze([(e.clientX - bounds.left - bounds.width / 2) / bounds.width * 2, (e.clientY - bounds.top - bounds.height / 2) / bounds.height * 2]);
            }
          }}
          onPointerLeave={() => setGaze([0, 0])}
          onKeyDown={e => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
            e.preventDefault();
            if (!canMove()) return;
            if (e.key === "Home") resetView();
            else setView(([x, y]) => [Math.max(-35, Math.min(35, x + (e.key === "ArrowUp" ? -8 : e.key === "ArrowDown" ? 8 : 0))), Math.max(-65, Math.min(65, y + (e.key === "ArrowLeft" ? -8 : e.key === "ArrowRight" ? 8 : 0)))]);
          }}>
          <BotAvatar name={id} avatar={shown} size={180} mood={mood} depth gaze={gaze} view={view} />
        </div>
        <span className="text-[12px] text-muted-foreground">Drag to turn · arrow keys also work</span>
        <Tabs value={mood} onValueChange={value => setMood(value as AvatarMood)} className="w-full items-center [&_[data-slot=tabs-trigger]]:transition-none">
          <TabsList aria-label="Try an expression"><TabsTrigger value="idle">Idle</TabsTrigger><TabsTrigger value="thinking">Thinking</TabsTrigger><TabsTrigger value="happy">Happy</TabsTrigger></TabsList>
          <TabsContent value={mood}><p className="mt-2 min-h-8 max-w-[210px] text-center text-sm leading-[1.6] text-muted-foreground max-[600px]:min-h-0 max-[600px]:max-w-none">Expression preview. Your agent uses its real activity outside this editor.</p></TabsContent>
        </Tabs>
      </div>
      <FieldGroup className="gap-[22px] max-[600px]:gap-[18px]">
        <FieldSet disabled={blocked}><FieldLegend className="mb-2.5 text-sm data-[variant=legend]:text-sm">Character</FieldLegend><div className="grid grid-cols-4 gap-[7px]">{choices.map(({ id: shape, name: characterName }) => <label className="group relative cursor-pointer" key={shape}>
          <input className={OPTION_INPUT} type="radio" name={`avatar-shape-${id}`} value={shape} checked={shown.shape === shape} onChange={() => change({ shape })} aria-label={characterName} />
          <span className={`pointer-events-none flex flex-col items-center gap-[3px] rounded-[9px] border border-transparent px-px py-[7px] peer-checked:border-foreground peer-checked:bg-muted [@media(hover:hover)_and_(pointer:fine)]:group-hover:bg-muted ${OPTION_FOCUS}`}><BotAvatar name={id} avatar={{ ...shown, shape, animated: false }} size={38} /><small className="text-[12px] text-muted-foreground">{characterName}</small></span>
        </label>)}</div></FieldSet>
        <FieldSet disabled={blocked}><FieldLegend className="mb-2.5 text-sm data-[variant=legend]:text-sm">Colour</FieldLegend><div className="grid w-full grid-cols-[repeat(auto-fit,minmax(32px,1fr))] justify-items-center gap-3">
          <label className="group relative grid size-8 place-items-center cursor-pointer max-md:size-11"><input className={OPTION_INPUT} type="radio" name={`avatar-color-${id}`} checked={shown.color === null} onChange={() => change({ color: null })} aria-label="Automatic colour" /><span className={`${COLOR_SPAN} border border-border bg-muted font-mono text-[12px] leading-normal text-foreground`}>A</span></label>
          {AVATAR_COLORS.map(color => <label className="group relative grid size-8 place-items-center cursor-pointer max-md:size-11" key={color}><input className={OPTION_INPUT} type="radio" name={`avatar-color-${id}`} checked={shown.color === color} onChange={() => change({ color })} aria-label={label(color)} /><span className={COLOR_SPAN} style={{ background: avatarColors[color] }} /></label>)}
        </div></FieldSet>
        <Field orientation="horizontal" className="justify-between gap-3"><FieldLabel htmlFor={`avatar-motion-${id}`}>Animate avatar</FieldLabel><Switch id={`avatar-motion-${id}`} disabled={blocked} checked={animated} onCheckedChange={value => { change({ animated: value }); resetView(); }} /></Field>
        <Field orientation="horizontal" className="justify-between gap-3"><FieldLabel htmlFor={`avatar-follow-${id}`}>Eyes follow pointer</FieldLabel><Switch id={`avatar-follow-${id}`} checked={follow} disabled={!animated || busy} onCheckedChange={value => { setFollow(value); setGaze([0, 0]); }} /></Field>
        <FieldDescription className="-mt-2 text-[13px] leading-[1.7]">Your reduced motion preference always wins. Pointer following is only used here.</FieldDescription>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={blocked} onClick={() => change({ shape: choices[(choices.findIndex(choice => choice.id === shown.shape) + 3) % choices.length].id, color: AVATAR_COLORS[(AVATAR_COLORS.indexOf(shown.color ?? auto.color) + 4) % AVATAR_COLORS.length] })}><Shuffle data-icon="inline-start" />Shuffle</Button>
          <Button variant="ghost" size="sm" disabled={blocked} onClick={() => { setDraft(null); setMood("idle"); setFollow(true); resetView(); }}><RotateCcw data-icon="inline-start" />Reset</Button>
        </div>
      </FieldGroup>
    </div>
    <DialogFooter className="-mx-6 -mb-6 border-t-0 px-6 py-4 max-[600px]:-mx-5 max-[600px]:-mb-5 max-[600px]:px-5 max-[600px]:py-3.5"><Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button disabled={blocked} onClick={() => void save()}>{busy ? "Saving…" : "Save avatar"}</Button></DialogFooter>
  </>;
}
