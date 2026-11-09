import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import type { ReactNode } from "react";
import { hrefFor, type Route } from "../route";
import type { StreamStatus } from "../stream";
import type { BotInfo, Room } from "../types";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./BotAvatar";
import { Icon } from "./Icon";
import { Logo } from "./Logo";

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

const EYEBROW = "m-0 text-xs leading-4 font-medium uppercase tracking-[.08em] text-muted-foreground";
const MONO_SUB = "text-xs leading-[14px] text-muted-foreground [font-family:var(--mono)]";

export function ClassicShell({
  rooms,
  route,
  bots = [],
  connectorCount = null,
  status,
  via = null,
  children,
}: {
  rooms: Room[];
  route: Route;
  /** Pending approvals per room id; shown as an amber count beside the room. */
  /** Bots in the active room (left nav "Bots in <room>"). Empty outside a room. */
  bots?: BotInfo[];
  /** Installed Apps/MCP entries; shown beside Connectors when above zero. */
  connectorCount?: number | null;
  status: StreamStatus;
  /** "webrtc" when the desk reaches the daemon over the WebRTC transport. */
  via?: "webrtc" | null;
  children: ReactNode;
}) {
  const activeRoom = route.kind === "room" ? route.roomId : null;
  const activeRoomName = rooms.find((r) => r.id === activeRoom)?.name ?? activeRoom;
  const tab = (
    kind: "room" | "computer" | "automations" | "connectors" | "bots" | "settings",
    label: string,
    icon: "rooms" | "computer" | "automations" | "connectors" | "bots" | "settings",
    show: "both" | "phone" | "desk" = "both",
    badge?: number,
    count?: number | null,
  ) => (
    <a
      href={hrefFor(kind === "room" ? activeRoom ? { kind, roomId: activeRoom } : { kind: "home" } : { kind })}
      aria-current={route.kind === kind ? "page" : undefined}
      className={cn(
        buttonVariants({variant:"ghost",size:"sm"}),
        "relative h-auto min-h-14 gap-2 no-underline max-[859px]:flex-col max-[859px]:text-xs min-[860px]:justify-start aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",

        show === "phone" && "flex min-[860px]:hidden",
        show === "desk" && "hidden min-[860px]:flex",
      )}
    >
      <Icon name={icon} />
      {label}
      {count ? <span className="ml-auto font-mono text-xs leading-4 text-muted-foreground max-[859px]:absolute max-[859px]:top-1 max-[859px]:right-[50%] max-[859px]:mr-[-26px] max-[859px]:ml-0" aria-label={`${count} connected`}>{count}</span> : null}
      {badge ? <Badge variant="attention" className="min-[860px]:ml-auto" aria-label={`${badge} pending`}>{badge}</Badge> : null}
    </a>
  );

  return (
    <div data-slot="classic-shell" className="flex min-h-dvh flex-col pb-[calc(68px_+_env(safe-area-inset-bottom))] min-[860px]:h-dvh min-[860px]:min-h-0 min-[860px]:overflow-hidden min-[860px]:pb-0">
        <Button role="link" nativeButton={false} render={<a href="#desk-content" />} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50" onClick={event => { event.preventDefault(); document.getElementById("desk-content")?.focus(); }}>Skip to content</Button>
      <header className="flex min-h-[52px] flex-wrap items-center gap-4 border-b border-border px-5">
        <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-[-.01em]">
          <Logo size={22} />
          OpenAg
        </span>
        <span className="grow" />
        <Badge variant={status === "live" ? "success" : "attention"} role="status">{STATUS_LABEL[status]}</Badge>
        {via === "webrtc" && (
          <Badge variant="outline" title="Connected to the daemon over WebRTC, without a VPN">
            via WebRTC
          </Badge>
        )}
        <a className={cn(buttonVariants({variant:"ghost",size:"icon"}), "hidden max-[859px]:inline-flex")} href={hrefFor({ kind: "settings" })} aria-label="Settings">
          <Icon name="settings" />
        </a>

      </header>

      <div className="flex min-w-0 flex-1 flex-col min-[860px]:min-h-0 min-[860px]:flex-row min-[860px]:overflow-hidden">
        <div className="contents min-[860px]:flex min-[860px]:w-60 min-[860px]:flex-[0_0_240px] min-[860px]:flex-col min-[860px]:gap-6 min-[860px]:overflow-y-auto min-[860px]:border-r min-[860px]:border-border min-[860px]:px-3 min-[860px]:py-4">
          <nav className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2 min-[860px]:flex-col min-[860px]:gap-0.5 min-[860px]:overflow-visible min-[860px]:border-0 min-[860px]:p-0" aria-label="Rooms">
            <div className={cn(EYEBROW, "hidden min-[860px]:block min-[860px]:px-2 min-[860px]:pb-1.5")}>Rooms</div>
            {rooms.map((r) => (
              <a
                key={r.id}
                href={hrefFor({ kind: "room", roomId: r.id })}
                aria-current={activeRoom === r.id ? "page" : undefined}
                className={cn(buttonVariants({variant:"ghost"}), "justify-between no-underline aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground")}
              >
                #{r.name}
              </a>
            ))}
          </nav>

          {bots.length > 0 && (
            <section className="hidden min-[860px]:flex min-[860px]:flex-col min-[860px]:gap-0.5" aria-label={`Bots in ${activeRoomName}`}>
              <div className={cn(EYEBROW, "px-2 pb-1.5")}>Bots in {activeRoomName}</div>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {bots.map((b) => (
                  <li key={b.id} className="flex min-h-10 min-w-0 items-center gap-2.5 px-2.5">
                    <BotAvatar name={b.id} avatar={b.avatar} />
                    <span className="flex min-w-0 flex-col leading-[1.2] [overflow-wrap:anywhere]">
                      <span>{b.name}</span>
                      <span className={MONO_SUB}>
                        {b.runtime}
                        {b.adapter ? ` · ${b.adapter}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] max-[859px]:px-3 max-[859px]:pt-2 max-[859px]:pb-0 min-[860px]:static min-[860px]:mt-auto min-[860px]:flex min-[860px]:flex-col min-[860px]:gap-0.5 min-[860px]:border-0 min-[860px]:bg-transparent min-[860px]:p-0" aria-label="Main">
            {tab("room", "Rooms", "rooms", "phone")}
            {tab("computer", "Computer", "computer")}
            {tab("automations", "Automations", "automations", "desk")}
            {tab("connectors", "Connectors", "connectors", "desk", undefined, connectorCount)}
            {tab("settings", "Settings", "settings", "desk")}
          </nav>
        </div>

        <main id="desk-content" tabIndex={-1} className={cn("min-w-0 flex-1 min-[860px]:overflow-y-auto", ["room", "ledger", "settings", "bots", "connectors", "automations"].includes(route.kind) ? "p-0" : "p-4 min-[860px]:px-6 min-[860px]:py-5")}>{children}</main>
      </div>
    </div>
  );
}
