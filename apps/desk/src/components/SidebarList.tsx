import { cn } from "@/lib/utils";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SidebarMenuItem } from "./ui/sidebar";

type Preferences = { order: string[]; pins: string[] };
const empty = (): Preferences => ({ order: [], pins: [] });
function read(key: string): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value && [value.order, value.pins].every((list) => Array.isArray(list) && list.every((id: unknown) => typeof id === "string"))) return value;
  } catch { /* Navigation still works when storage is unavailable. */ }
  return empty();
}

export function SidebarList<T extends { id: string; name: string }>({ kind, items, children }: {
  kind: "agents" | "rooms"; items: T[]; children: (item: T) => ReactNode;
}) {
  const key = `openag.sidebar.${kind}`;
  const [prefs, setPrefs] = useState(() => read(key));
  const [drag, setDrag] = useState<{ id: string; target: string | null } | null>(null);
  const [notice, setNotice] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const beforeDrop = useRef<Map<string, number> | null>(null);
  const settling = useRef(new Set<Animation>());
  function stopSettling() {
    for (const animation of settling.current) animation.cancel();
    settling.current.clear();
  }
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { beforeDrop.current = null; stopSettling(); };
    reduced.addEventListener("change", stop);
    window.addEventListener("resize", stop);
    window.addEventListener("hashchange", stop);
    return () => { stop(); reduced.removeEventListener("change", stop); window.removeEventListener("resize", stop); window.removeEventListener("hashchange", stop); };
  }, []);
  const pinned = (id: string) => prefs.pins.includes(id);
  const ordered = [...items].sort((a, b) => Number(pinned(b.id)) - Number(pinned(a.id)) ||
    (prefs.order.includes(a.id) ? prefs.order.indexOf(a.id) : Infinity) - (prefs.order.includes(b.id) ? prefs.order.indexOf(b.id) : Infinity));
  const orderKey = JSON.stringify(ordered.map(item => item.id));
  useLayoutEffect(() => {
    const before = beforeDrop.current;
    beforeDrop.current = null;
    stopSettling();
    if (!before || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, element] of rows.current) {
      const previous = before.get(id);
      if (previous === undefined || !element.animate) continue;
      const delta = previous - element.getBoundingClientRect().top;
      if (!delta) continue;
      const animation = element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      settling.current.add(animation);
      animation.onfinish = animation.oncancel = () => { settling.current.delete(animation); };
    }
  }, [orderKey]);
  function save(next: Preferences, message: string) {
    setPrefs(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setNotice(message); }
    catch { setNotice(`${message} Changes last only until this page closes because browser storage is unavailable.`); }
  }
  function move(id: string, target: string, pointerDrop = false) {
    if (id === target || pinned(id) !== pinned(target)) return;
    beforeDrop.current = pointerDrop && !matchMedia("(prefers-reduced-motion: reduce)").matches
      ? new Map([...rows.current].map(([id, element]) => [id, element.getBoundingClientRect().top])) : null;
    stopSettling();
    const order = ordered.map((item) => item.id);
    order.splice(order.indexOf(id), 1);
    order.splice(ordered.findIndex((item) => item.id === target), 0, id);
    save({ ...prefs, order }, `Moved ${items.find((item) => item.id === id)?.name}.`);
  }
  return <>
    <li className="sr-only" role="status">{notice}</li>
    {ordered.map((item, index) => <SidebarMenuItem key={item.id} ref={element => { if (element) rows.current.set(item.id, element); else rows.current.delete(item.id); }} data-nav-id={item.id} data-nav-kind={kind}
      className={`desk-sortable ${drag?.id === item.id ? "desk-dragging" : ""} ${drag?.target === item.id ? "desk-drop-target" : ""}`}>
      <Button type="button" variant="ghost" size="icon-xs" className="h-11 w-6 shrink-0 cursor-grab touch-none text-muted-foreground [@media(pointer:coarse)]:w-11" aria-label={`Drag ${item.name} to reorder`} title="Drag to reorder; use the menu to move without dragging"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          beforeDrop.current = null; stopSettling();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ id: item.id, target: null });
        }}
        // shortcut: drag targets must be visible; add edge scrolling if long sidebars need it.
        onPointerMove={(event) => {
          if (!drag || drag.id !== item.id) return;
          const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-nav-id]");
          const target = row?.dataset.navKind === kind ? row.dataset.navId : undefined;
          setDrag({ id: item.id, target: target && target !== item.id && pinned(target) === pinned(item.id) ? target : null });
        }}
        onPointerUp={() => { if (drag?.target) move(item.id, drag.target, true); setDrag(null); }}
        onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}><GripVertical aria-hidden="true" /></Button>
      <div className="desk-sortable-link">{children(item)}</div>
      <Popover><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" className={cn("h-11 w-6 shrink-0 text-muted-foreground [@media(pointer:coarse)]:w-11", kind === "agents" && "desk-agent-options")} data-pinned={pinned(item.id)} aria-label={`Options for ${item.name}`} />}>
        {pinned(item.id) ? <Pin aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
      </PopoverTrigger><PopoverContent align="end" className="w-44 gap-0.5 p-1" aria-label={`Organize ${item.name}`}>
        <Button type="button" variant="ghost" className="justify-start" onClick={() => save({ ...prefs, pins: pinned(item.id) ? prefs.pins.filter((id) => id !== item.id) : [...prefs.pins, item.id] }, `${pinned(item.id) ? "Unpinned" : "Pinned"} ${item.name}.`)}>
          {pinned(item.id) ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}{pinned(item.id) ? "Unpin" : "Pin to top"}
        </Button>
        <Button type="button" variant="ghost" className="justify-start" disabled={!ordered[index - 1] || pinned(ordered[index - 1].id) !== pinned(item.id)} onClick={() => move(item.id, ordered[index - 1].id)}><ArrowUp data-icon="inline-start" />Move up</Button>
        <Button type="button" variant="ghost" className="justify-start" disabled={!ordered[index + 1] || pinned(ordered[index + 1].id) !== pinned(item.id)} onClick={() => move(item.id, ordered[index + 1].id)}><ArrowDown data-icon="inline-start" />Move down</Button>
      </PopoverContent></Popover>
    </SidebarMenuItem>)}
  </>;
}
