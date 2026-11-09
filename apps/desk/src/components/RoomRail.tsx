import type { ModelReport } from "../types";
import { ResultsPanel } from "./ResultsPanel";
import { useEffect, useState } from "react";
import type { Api } from "../api";
import { hrefFor } from "../route";
import type { Approval, BotInfo, BotModelState, LedgerEvent, Room } from "../types";
import { useStream } from "../stream";
import { BrainCircuit, Cpu, Clock3, Monitor } from "lucide-react";
import { BotAvatar } from "./BotAvatar";
import { ActivityTrace, isActivity } from "./ActivityTrace";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/** Bot ids with a turn in flight: the latest turn_started has no later turn_finished. */
export function runningBots(events: readonly LedgerEvent[]): string[] {
  const running = new Set<string>();
  for (const e of events) {
    if (e.type === "turn_started") running.add(e.actor);
    else if (e.type === "turn_finished") running.delete(e.actor);
  }
  return [...running];
}

const SHOT_MS = 5000;

/** Live screenshot of the managed computer, refreshed while it runs and the tab is visible. */
function ComputerTile({ api }: { api: Api }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<string>("unknown");

  useEffect(() => {
    let alive = true;
    let current: string | null = null;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const status = await api.getComputer();
        if (!alive) return;
        setState(status.state);
        if (status.state !== "running") {
          if (current) URL.revokeObjectURL(current);
          current = null;
          setUrl(null);
          return;
        }
        const next = URL.createObjectURL(await api.computerScreenshot());
        if (!alive) {
          URL.revokeObjectURL(next);
          return;
        }
        if (current) URL.revokeObjectURL(current);
        current = next;
        setUrl(next);
      } catch {
        if (alive) setState("unknown");
      }
    };
    void tick();
    const id = setInterval(() => void tick(), SHOT_MS);
    return () => {
      alive = false;
      clearInterval(id);
      if (current) URL.revokeObjectURL(current);
    };
  }, [api]);

  return (
    <a className="flex aspect-[16/10] items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-input bg-muted text-xs text-muted-foreground no-underline [&_img]:block [&_img]:size-full [&_img]:object-cover" href={hrefFor({ kind: "computer" })}>
      {url && state === "running" ? (
        <img src={url} alt="Live screen of the computer" />
      ) : (
        <>
          <Monitor aria-hidden="true" />
          {state === "running" ? "Loading screen" : state === "unknown" ? "Computer status unavailable" : "Computer is not running"}
        </>
      )}
    </a>
  );
}

/** Room-scoped context; pending decisions remain in their originating conversation. */
export function RoomRail({ api, approvals, events, bots, room }: {
  api: Api;
  approvals: readonly Approval[];
  events: readonly LedgerEvent[];
  bots: readonly BotInfo[];
  rooms: readonly Room[];
  room?: Room | null;
}) {
  if (!room) return <p className="-mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">Room details are unavailable.</p>;
  const direct = room.kind === "direct" ? bots[0] : undefined;
  const running = new Set(runningBots(events));
  const waiting = new Set(approvals.filter((a) => a.roomId === room.id).map((a) => a.botId));
  const activity = events.filter((event) => event.roomId === room.id && isActivity(event));
  return <Tabs defaultValue="context" className="min-h-0 gap-6 p-5">
    <TabsList variant="line" className="w-full shrink-0" aria-label="Conversation details">
      <TabsTrigger value="context">{direct ? "Agent" : "Room"}</TabsTrigger>
      <TabsTrigger value="files">Files</TabsTrigger>
      <TabsTrigger value="activity">Activity</TabsTrigger>
      <TabsTrigger value="computer">Computer</TabsTrigger>
    </TabsList>
    <TabsContent value="context"><RoomSummary api={api} room={room} bots={bots} approvals={approvals} events={events}/></TabsContent>
    <TabsContent value="files"><ResultsPanel api={api} roomId={direct ? undefined : room.id} botId={direct?.id} /></TabsContent>
    <TabsContent value="activity">{activity.length ? <ActivityTrace events={activity} bots={bots} /> : <p className="-mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">No activity yet.</p>}</TabsContent>
    <TabsContent value="computer"><ComputerTile api={api} /><p className="-mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">Open Computer to view its status and controls.</p></TabsContent>
  </Tabs>;
}

/** Saved bot model configuration from the daemon; null while loading, "error" when unavailable. Refreshes when the model, a turn or the config changes. */
function useBotModel(api: Api, botId: string, revision?: string): BotModelState | "error" | null {
  const [state, setState] = useState<BotModelState | "error" | null>(null);
  const { subscribe } = useStream();
  useEffect(() => {
    let live = true;
    setState(null);
    const load = () => { void api.getBotModel(botId).then(v => { if (live) setState(v); }).catch(() => { if (live) setState(s => s ?? "error"); }); };
    load();
    const off = subscribe({ onOpen: load, onEvent: e => { if (e.actor === botId && ["model_report", "turn_finished"].includes(e.type) || e.type === "config" && (e.payload as { botId?: string } | null)?.botId === botId) load(); } });
    return () => { live = false; off(); };
  }, [api, botId, revision, subscribe]);
  return state;
}

/** Summary badges use only reports from this conversation and the current model configuration. */
function BotModelBadges({ api, bot, room, events }: { api: Api; bot: BotInfo; room: Room; events: readonly LedgerEvent[] }) {
  const state = useBotModel(api, bot.id, bot.modelRevision);
  const loaded = state && state !== "error" && (!bot.modelRevision || state.revision === bot.modelRevision) ? state : null;
  const revision = bot.modelRevision ?? loaded?.revision;
  const local = events.filter(e => e.type === "model_report" && e.actor === bot.id && e.roomId === room.id).map(e => ({ ...(e.payload as ModelReport), roomId: room.id, at: e.ts }));
  const reports = [...(loaded?.reports ?? []), ...local].filter(r => r.roomId === room.id && !!revision && r.revision === revision && r.freshness !== "previous-configuration");
  const newest = (rows: ModelReport[]) => rows.reduce<ModelReport | undefined>((latest, next) => !latest || next.at > latest.at ? next : latest, undefined);
  const modelReport = newest(reports.filter(r => r.modelName || r.model));
  const effortReport = newest(reports.filter(r => r.effort !== undefined));
  const configured = loaded?.effectiveModel ?? loaded?.model;
  const model = modelReport?.modelName ?? modelReport?.model ?? configured ?? (state === "error" ? "Unavailable" : loaded ? "Runtime default" : "Loading…");
  const configuredEffort = loaded?.reasoning.reasoning_effort ?? loaded?.reasoning.effort;
  const effort = effortReport?.effort ?? configuredEffort;
  const source = modelReport ? modelReport.source === "response" ? "Returned model" : "Session model" : "Configured model";
  return <div className="flex min-w-0 flex-wrap gap-1.5">
    <Badge variant="secondary" className="max-w-full" title={`${source}: ${model}`}><Cpu aria-hidden="true" data-icon="inline-start" /><span className="truncate">{model}</span></Badge>
    {effort !== undefined && <Badge variant="outline" className="max-w-full" title={`${effortReport ? "Reported" : "Configured"} effort: ${effort}`}><BrainCircuit aria-hidden="true" data-icon="inline-start" /><span className="truncate">{String(effort)}</span></Badge>}
  </div>;
}

function AgentPresence({ bot, working }: { bot: BotInfo; working: boolean }) {
  return <span className="agent-presence">
    <BotAvatar name={bot.id} size={32} avatar={bot.avatar} />
    {working && <span className="agent-working" role="status" aria-label={`${bot.name} is working`}><span /><span /><span /></span>}
  </span>;
}

export function RoomSummary({api,room,bots,approvals,events}:{api:Api;room:Room;bots:readonly BotInfo[];approvals:readonly Approval[];events:readonly LedgerEvent[]}){
  const direct=room.kind==="direct"?bots.find(bot=>bot.id===room.members[0]):undefined;
  const running=new Set(runningBots(events));
  const waiting=new Set(approvals.filter(a=>a.roomId===room.id).map(a=>a.botId));
  const participants = direct ? [direct] : bots;
  return <section className="flex flex-col gap-5" aria-label={direct ? "Agent details" : "In this room"}>
    {!direct && <h2 className="m-0 flex items-center justify-between text-sm font-semibold">In this room <Badge variant="outline">{bots.length} agents</Badge></h2>}
    {participants.map(bot => <div className="flex items-start gap-3" key={bot.id}>
      <AgentPresence bot={bot} working={running.has(bot.id) && !waiting.has(bot.id)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2"><strong className="truncate text-sm font-medium" title={`${bot.name} @${bot.id}`}>{bot.name}</strong>{!direct && room.leadBotId === bot.id && <Badge variant="outline">Lead</Badge>}</div>
        <BotModelBadges api={api} bot={bot} room={room} events={events} />
        {waiting.has(bot.id) && <Badge variant="attention"><Clock3 aria-hidden="true" data-icon="inline-start" />Approval needed</Badge>}
      </div>
    </div>)}
    {direct?.description && <p className="m-0 text-[13px] leading-5 text-muted-foreground">{direct.description}</p>}
  </section>;
}
