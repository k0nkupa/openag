import { useRef, useState } from "react";
import { Pencil, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BotAvatar, avatarColors, avatarPaths, defaultAvatars, useAvatars, type AvatarConfig, type AvatarMood, type AvatarShape } from "./bot-avatar";
import { useDemo } from "./demo-context";
import type { BotId } from "./data";

const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const shapes = Object.keys(avatarPaths) as AvatarShape[];

export function AvatarSettingsButton({ bot, name }: { bot: BotId; name: string }) {
  const [open, setOpen] = useState(false);
  const { avatars } = useAvatars();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" className="avatar-edit-trigger" aria-label={`Change avatar for ${name}`} />}>
      <BotAvatar config={{ ...avatars[bot], color: avatars[bot].color ?? defaultAvatars[bot].color }} size={56} /><span className="avatar-edit-mark"><Pencil /></span>
    </DialogTrigger>
    <DialogContent className="avatar-dialog">{open && <AvatarEditor bot={bot} name={name} close={() => setOpen(false)} />}</DialogContent>
  </Dialog>;
}

function AvatarEditor({ bot, name, close }: { bot: BotId; name: string; close: () => void }) {
  const { avatars, saveAvatar } = useAvatars();
  const { announce } = useDemo();
  const [draft, setDraft] = useState(avatars[bot]);
  const [mood, setMood] = useState<AvatarMood>("idle");
  const [view, setView] = useState<[number, number]>([-8, 0]);
  const [gaze, setGaze] = useState<[number, number]>([0, 0]);
  const [follow, setFollow] = useState(true);
  const drag = useRef<{ x: number; y: number; view: [number, number] } | null>(null);
  const shown: AvatarConfig = { ...draft, color: draft.color ?? defaultAvatars[bot].color };
  const resetView = () => { setView([-8, 0]); setGaze([0, 0]); };
  return <>
    <DialogHeader><DialogTitle>{name}’s avatar</DialogTitle><DialogDescription>Give your agent a familiar face.</DialogDescription></DialogHeader>
    <div className="avatar-editor-body">
      <div className="avatar-preview-column">
        <div className="avatar-stage" role="group" tabIndex={0} aria-label="Avatar view. Drag or use arrow keys to turn. Home resets the view."
          onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, view }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerMove={e => {
            if (!draft.animated || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            if (drag.current) {
              const start = drag.current;
              setView([Math.max(-35, Math.min(35, start.view[0] - (e.clientY - start.y) * .3)), Math.max(-65, Math.min(65, start.view[1] + (e.clientX - start.x) * .4))]);
            } else if (follow && e.pointerType === "mouse") {
              const bounds = e.currentTarget.getBoundingClientRect();
              setGaze([(e.clientX - bounds.left - bounds.width / 2) / bounds.width * 7, (e.clientY - bounds.top - bounds.height / 2) / bounds.height * 5]);
            }
          }}
          onPointerLeave={() => setGaze([0, 0])}
          onKeyDown={e => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
            e.preventDefault();
            if (e.key === "Home") resetView();
            else setView(([x, y]) => [Math.max(-35, Math.min(35, x + (e.key === "ArrowUp" ? -8 : e.key === "ArrowDown" ? 8 : 0))), Math.max(-65, Math.min(65, y + (e.key === "ArrowLeft" ? -8 : e.key === "ArrowRight" ? 8 : 0)))]);
          }}>
          <div className="avatar-stage-turn" data-animated={draft.animated} style={{ transform: `rotateX(${view[0]}deg) rotateY(${view[1]}deg)` }}><BotAvatar config={shown} size={180} mood={mood} depth gaze={gaze} /></div>
        </div>
        <span className="avatar-view-hint">Drag to turn · arrow keys also work</span>
        <Tabs value={mood} onValueChange={value => setMood(value as AvatarMood)} className="avatar-moods">
          <TabsList aria-label="Try an expression"><TabsTrigger value="idle">Idle</TabsTrigger><TabsTrigger value="thinking">Thinking</TabsTrigger><TabsTrigger value="happy">Happy</TabsTrigger></TabsList>
          <TabsContent value={mood}><p className="avatar-mood-note">{mood === "thinking" ? "A curious wobble while work is in progress." : mood === "happy" ? "A warm response when the work is done." : "A gentle sway. Ready when you are."}</p></TabsContent>
        </Tabs>
      </div>
      <FieldGroup className="avatar-controls">
        <FieldSet><FieldLegend>Shape</FieldLegend><div className="avatar-shape-grid">{shapes.map(shape => <label className="avatar-shape-option" key={shape}>
          <input type="radio" name="avatar-shape" value={shape} checked={draft.shape === shape} onChange={() => setDraft(d => ({ ...d, shape }))} aria-label={label(shape)} />
          <span><BotAvatar config={{ ...shown, shape, animated: false }} size={38} /><small>{label(shape)}</small></span>
        </label>)}</div></FieldSet>
        <FieldSet><FieldLegend>Colour</FieldLegend><div className="avatar-colors">
          <label className="avatar-color-option"><input type="radio" name="avatar-color" checked={draft.color === null} onChange={() => setDraft(d => ({ ...d, color: null }))} aria-label="Automatic colour" /><span className="avatar-auto-color">A</span></label>
          {avatarColors.map(color => <label className="avatar-color-option" key={color}><input type="radio" name="avatar-color" checked={draft.color === color} onChange={() => setDraft(d => ({ ...d, color }))} aria-label={label(color)} /><span style={{ background: `var(--bot-${color})` }} /></label>)}
        </div></FieldSet>
        <Field orientation="horizontal"><FieldLabel htmlFor="avatar-motion">Animate avatar</FieldLabel><Switch id="avatar-motion" checked={draft.animated} onCheckedChange={animated => setDraft(d => ({ ...d, animated }))} /></Field>
        <Field orientation="horizontal"><FieldLabel htmlFor="avatar-follow">Eyes follow pointer</FieldLabel><Switch id="avatar-follow" checked={follow} disabled={!draft.animated} onCheckedChange={setFollow} /></Field>
        <FieldDescription>Your reduced motion preference is always respected. Pointer following is only used here.</FieldDescription>
        <div className="avatar-secondary-actions">
          <Button variant="outline" size="sm" onClick={() => setDraft(d => ({ ...d, shape: shapes[(shapes.indexOf(d.shape) + 3) % shapes.length], color: avatarColors[(avatarColors.indexOf(shown.color!) + 4) % avatarColors.length] }))}><Shuffle data-icon="inline-start" />Shuffle</Button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft({ ...defaultAvatars[bot] }); setMood("idle"); setFollow(true); resetView(); }}><RotateCcw data-icon="inline-start" />Reset</Button>
        </div>
      </FieldGroup>
    </div>
    <DialogFooter><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => { saveAvatar(bot, draft); announce(`${name}’s avatar updated.`); close(); }}>Save avatar</Button></DialogFooter>
  </>;
}
