import { NewRoomTrigger } from "./NewRoomSheet";
import { NewBotTrigger } from "./NewBotSheet";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, Hash, Inbox, ListChecks, Monitor, Network, Settings, Zap } from "lucide-react";
import { messageOf } from "../api";
import type { BotInfo } from "../types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import type { Whoami } from "../api";
import { hrefFor, type Route } from "../route";
import { BotAvatar } from "./BotAvatar";
import { ClassicShell } from "./ClassicShell";
import { Logo } from "./Logo";
import { SidebarList } from "./SidebarList";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "./ui/sidebar";

type ShellProps = Parameters<typeof ClassicShell>[0] & { identity?: Whoami | null; onOpenChat?: (bot: BotInfo) => Promise<void> };
const PAGES: { label: string; route: Route; icon: typeof Inbox }[] = [
  { label: "Work", route: { kind: "work" }, icon: ListChecks },
  { label: "Computer", route: { kind: "computer" }, icon: Monitor },
  { label: "Automations", route: { kind: "automations" }, icon: Zap },
  { label: "App library", route: { kind: "app-library" }, icon: Network },
];
const SETTINGS_NAMES = { profile: "Profile", models: "Models", proactive: "Proactive", devices: "Devices" };

export function Shell(props: ShellProps) {
  if (new URLSearchParams(window.location.search).get("desk") === "classic") {
    const roomId = props.route.kind === "room" ? props.route.roomId : null;
    const members = props.rooms.find((room) => room.id === roomId)?.members ?? [];
    return <ClassicShell {...props} bots={props.bots?.filter((bot) => members.includes(bot.id))} />;
  }
  return (
    <SidebarProvider className="desk-shell" style={{ "--sidebar-width": "232px" } as CSSProperties}>
      <DeskShell {...props} />
    </SidebarProvider>
  );
}

function DeskShell({ rooms, route, bots = [], connectorCount, identity, onOpenChat, children }: ShellProps) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [route, setOpenMobile]);
  const [searchOpen, setSearchOpen] = useState(false);
  const chatOpening = useRef(false);
  const [chatError, setChatError] = useState<string | null>(null);
  async function openChat(bot: BotInfo) {
    if (!onOpenChat || chatOpening.current) return;
    chatOpening.current = true;
    setChatError(null);
    try { await onOpenChat(bot); setOpenMobile(false); }
    catch (err) { setChatError(messageOf(err)); }
    finally { chatOpening.current = false; }
  }
  const activeRoom = route.kind === "room" ? rooms.find((r) => r.id === route.roomId) : undefined;
  const directBot = activeRoom?.kind === "direct" ? bots.find((b) => b.id === activeRoom.members[0]) : undefined;
  const agentRoute = (id: string): Route => {
    const room = rooms.find((r) => r.kind === "direct" && r.members.length === 1 && r.members[0] === id && r.leadBotId === id);
    return room ? { kind: "room", roomId: room.id } : { kind: "bots", botId: id };
  };
  const settingsArea = ["settings", "connectors"].includes(route.kind);
  const pageName = route.kind === "room" ? directBot?.name ?? activeRoom?.name ?? route.roomId
    : route.kind === "settings" ? route.section ? route.section === "memory" ? "Bots" : SETTINGS_NAMES[route.section] : "Server"
    : route.kind === "connectors" ? "Connectors" : route.kind === "approval" ? "Decision & execution" : route.kind === "work" ? "Work" : route.kind === "bots" ? "Bots" : PAGES.find((p) => p.route.kind === route.kind)?.label ?? "OpenAg";
  const groupName = settingsArea ? "Settings" : route.kind === "room" ? directBot ? "Agents" : "Rooms" : "Workspace";

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const navigate = (target: Route) => {
    window.location.hash = hrefFor(target);
    setSearchOpen(false);
    setOpenMobile(false);
  };
  const pageItem = (page: (typeof PAGES)[number]) => {
    const active = route.kind === page.route.kind;
    return <SidebarMenuItem key={page.label}>
      <SidebarMenuButton render={<a href={hrefFor(page.route)} aria-current={active ? "page" : undefined} />}
        onClick={() => setOpenMobile(false)}
        isActive={active}>
        <page.icon aria-hidden="true" /><span>{page.label}</span>
        {page.route.kind === "app-library" && !!connectorCount && <Badge variant="secondary" className="ml-auto size-5 min-w-5 justify-center rounded-full px-0 tabular-nums" aria-label={`${connectorCount} installed`}>{connectorCount}</Badge>}
      </SidebarMenuButton>
    </SidebarMenuItem>;
  };
  return <>
    <Button role="link" nativeButton={false} render={<a href="#desk-content" />} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50" onClick={event => { event.preventDefault(); document.getElementById("desk-content")?.focus(); }}>Skip to content</Button>
    <Sidebar collapsible="offcanvas" className="desk-sidebar">
      <SidebarHeader>
        <a href={hrefFor({ kind: "home" })} className="desk-wordmark" onClick={() => setOpenMobile(false)}><Logo size={24} /><span>OpenAg</span></a>
      </SidebarHeader>
      <SidebarContent>
        {chatError && <Alert variant="destructive"><AlertDescription>{chatError}</AlertDescription></Alert>}
        <SidebarGroup><SidebarGroupLabel>Workspace</SidebarGroupLabel><SidebarMenu>{PAGES.slice(0,2).map(pageItem)}</SidebarMenu></SidebarGroup>
        <SidebarGroup><div className="flex items-center justify-between gap-2 pr-2"><SidebarGroupLabel>Rooms</SidebarGroupLabel><NewRoomTrigger onClick={() => setOpenMobile(false)} /></div><SidebarMenu>
          <SidebarList kind="rooms" items={rooms.filter((r) => r.kind !== "direct")}>{(r) => <>
            <SidebarMenuButton render={<a href={hrefFor({ kind: "room", roomId: r.id })} aria-current={activeRoom?.id === r.id ? "page" : undefined} />} isActive={activeRoom?.id === r.id} onClick={() => setOpenMobile(false)}>
              <Hash aria-hidden="true" /><span>{r.name}</span>
            </SidebarMenuButton>
          </>}</SidebarList>
          {!rooms.some((r) => r.kind !== "direct") && <p className="desk-empty-note">No rooms yet</p>}
        </SidebarMenu></SidebarGroup>
        <SidebarGroup><div className="flex items-center justify-between gap-2 pr-2"><SidebarGroupLabel>Agents</SidebarGroupLabel><NewBotTrigger iconOnly /></div><SidebarMenu>
          <SidebarList kind="agents" items={bots}>{(bot) => <>
            <SidebarMenuButton size="lg" className="desk-agent" render={<a href={hrefFor(agentRoute(bot.id))} aria-current={directBot?.id === bot.id || route.kind === "bots" && route.botId === bot.id ? "page" : undefined} />} isActive={directBot?.id === bot.id || route.kind === "bots" && route.botId === bot.id} onClick={(event) => {
                if (onOpenChat && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  event.preventDefault();
                  void openChat(bot);
                } else setOpenMobile(false);
              }}>
              <BotAvatar name={bot.id} avatar={bot.avatar} still /><span className="desk-agent-text"><span>{bot.name}</span><small>@{bot.id} · {bot.description || bot.adapter || bot.runtime}</small></span>
            </SidebarMenuButton>
          </>}</SidebarList>
        </SidebarMenu></SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>{PAGES.slice(2).map(pageItem)}</SidebarMenu>
        <SidebarMenuButton size="lg" className="h-auto min-h-12" render={<a href={hrefFor({ kind: "settings", section: "devices" })} />} onClick={() => setOpenMobile(false)}>
          <span className="desk-device-icon"><Monitor size={16} aria-hidden="true" /></span>
          <span className="flex min-w-0 flex-col"><strong className="truncate text-sm font-medium">{identity?.kind === "device" ? identity.name : identity?.kind === "owner" ? "Owner" : "This device"}</strong><small className="truncate text-xs text-muted-foreground">{identity ? identity.kind === "owner" || identity.access === "full" ? "Full access" : "Limited access" : "Device settings"}</small></span>
          <Settings className="ml-auto size-5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Open settings</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
    <div className="desk-main">
      {route.kind !== "room" && <header className="desk-topbar">
        <SidebarTrigger className="desk-sidebar-trigger" />
        <nav className="desk-breadcrumb" aria-label="Breadcrumb"><span>{groupName}</span><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{pageName}</span></nav>
      </header>}
      <main id="desk-content" tabIndex={-1} className={`desk-content desk-content-${route.kind}`}>{children}</main>
    </div>
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="Search desk" description="Find a room, agent, or settings page.">
      <Command><CommandInput aria-label="Search desk" placeholder="Find a room, agent, or page…" /><CommandList><CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Rooms">{rooms.map((r) => <CommandItem key={r.id} value={`room ${r.id}`} keywords={[r.name]} onSelect={() => navigate({ kind: "room", roomId: r.id })}><Hash />{r.name}</CommandItem>)}</CommandGroup>
        <CommandGroup heading="Agents">{bots.map((b) => <CommandItem key={b.id} value={`agent ${b.name} ${b.id}`} onSelect={() => { if (onOpenChat) { setSearchOpen(false); void openChat(b); } else navigate(agentRoute(b.id)); }}><BotAvatar name={b.id} avatar={b.avatar} />{b.name} · @{b.id}</CommandItem>)}</CommandGroup>
        <CommandGroup heading="Pages">{[...PAGES, { label: "Settings", route: { kind: "settings" } as Route, icon: Settings }, ...Object.entries(SETTINGS_NAMES).map(([section, label]) => ({ label, route: { kind: "settings", section } as Route, icon: Settings }))].map((p) => <CommandItem key={p.label} onSelect={() => navigate(p.route)}><p.icon />{p.label}</CommandItem>)}</CommandGroup>
      </CommandList></Command>
    </CommandDialog>
  </>;
}
