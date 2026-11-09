import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus } from "lucide-react";
import { messageOf } from "../api";
import { cropImage, saveProfileImage } from "../profile-image";
import { useUnsavedChanges } from "../unsaved-changes";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Slider } from "./ui/slider";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function ProfileImageEditor({ image, onSave, close }: { image: HTMLImageElement; onSave: (avatar: string) => void; close: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true), saving = useRef(false);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; rangeX: number; rangeY: number } | null>(null);
  useUnsavedChanges(true, busy);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const crop = cropImage(image.naturalWidth, image.naturalHeight, zoom, position.x, position.y);
  function move(x: number, y: number) { setPosition(current => ({ x: clamp(current.x + x), y: clamp(current.y + y) })); }
  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const avatar = await saveProfileImage(image, zoom, position.x, position.y);
      if (active.current) { onSave(avatar); close(); }
    } catch (err) { if (active.current) setError(messageOf(err)); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  }
  return <>
    <DialogHeader><DialogTitle>Adjust your image</DialogTitle><DialogDescription>Drag to position your image, or use the arrow buttons. Zoom to crop.</DialogDescription></DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-col items-center gap-5 py-4">
      <div role="img" aria-label="Avatar crop preview" className="relative aspect-square w-full max-w-64 touch-none overflow-hidden rounded-full bg-muted cursor-grab active:cursor-grabbing"
        onPointerDown={event => {
          if (busy || !event.isPrimary || event.button !== 0) return;
          const width = event.currentTarget.getBoundingClientRect().width;
          drag.current = { startX: event.clientX, startY: event.clientY, ...position, rangeX: width * (image.naturalWidth / crop.size - 1), rangeY: width * (image.naturalHeight / crop.size - 1) };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || busy) return;
          setPosition({ x: start.rangeX > 0 ? clamp(start.x - (event.clientX - start.startX) / start.rangeX) : start.x, y: start.rangeY > 0 ? clamp(start.y - (event.clientY - start.startY) / start.rangeY) : start.y });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <img src={image.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width: `${image.naturalWidth / crop.size * 100}%`, height: `${image.naturalHeight / crop.size * 100}%`, left: `${-crop.left / crop.size * 100}%`, top: `${-crop.top / crop.size * 100}%` }} />
      </div>
      <div className="flex gap-1" role="group" aria-label="Move image">
        {([{ label: "Move image left", icon: ArrowLeft, x: -0.05, y: 0 }, { label: "Move image up", icon: ArrowUp, x: 0, y: -0.05 }, { label: "Move image down", icon: ArrowDown, x: 0, y: 0.05 }, { label: "Move image right", icon: ArrowRight, x: 0.05, y: 0 }]).map(({ label, icon: Icon, x, y }) => <Button key={label} type="button" variant="ghost" size="icon" aria-label={label} disabled={busy} onClick={() => move(-x, -y)}><Icon /></Button>)}
      </div>
      <div className="flex w-full items-center gap-3">
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom out" disabled={busy || zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.1))}><Minus /></Button>
        <Slider aria-label="Zoom image" min={1} max={3} step={0.01} value={zoom} disabled={busy} onValueChange={setZoom} />
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom in" disabled={busy || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.1))}><Plus /></Button>
      </div>
    </div>
    <DialogFooter><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Preparing…" : "Use image"}</Button></DialogFooter>
  </>;
}
