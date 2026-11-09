import { EvidenceBlock } from "./EvidenceBlock";
import { Alert, AlertDescription } from "./ui/alert";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField, SelectItem } from "./ui/select";
import { Badge } from "./ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";
import { useEffect, useMemo, useState } from "react";
import { messageOf, type Api } from "../api";
import { mergeEvents, routerSuffix, summarizeEvent } from "../ledger";
import { hrefFor } from "../route";
import { useStream } from "../stream";
import type { BotInfo, LedgerEvent, Room } from "../types";

type Kind = "all" | "route" | "tool" | "approval" | "error";
const KINDS: Kind[] = ["all", "route", "tool", "approval", "error"];

// Payload block (was .payload) and the shared small button (was .small-btn).

function kindOf(t: LedgerEvent["type"]): Kind {
  if (t === "route") return "route";
  if (t === "tool_call" || t === "tool_result") return "tool";
  if (t === "approval_requested" || t === "approval_decided") return "approval";
  if (t === "error") return "error";
  return "all";
}



const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

/** Everything every bot did, across rooms. Read-only; payloads were redacted when they were appended. */
export function LedgerView({ api, rooms }: { api: Api; rooms: Room[] }) {
  const { subscribe } = useStream();
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roomId, setRoomId] = useState("");
  const [botId, setBotId] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [selected, setSelected] = useState<number | null>(null);

  const roomKey = rooms.map((r) => r.id).join("\n");
  useEffect(() => {
    let cancelled = false;
    const ids = roomKey ? roomKey.split("\n") : [];
    void Promise.all([
      ...ids.map((id) => api.listEvents(id).then((r) => r.events)),
      api.listBots().then((r) => { if (!cancelled) setBots(r.bots); return [] as LedgerEvent[]; }),
    ]).then(
      (lists) => {
        if (!cancelled) setEvents((prev) => mergeEvents(prev, lists.flat()));
      },
      (err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      },
    );
    const off = subscribe({
      onEvent: (e) => {
        if (!cancelled && ids.includes(e.roomId)) setEvents((prev) => mergeEvents(prev, [e]));
      },
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [api, roomKey, subscribe]);

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => (roomId ? e.roomId === roomId : true))
      .filter((e) => (botId ? e.actor === botId : true))
      .filter((e) => (kind === "all" ? true : kindOf(e.type) === kind))
      .filter((e) => (q ? `${e.actor} ${e.type} ${summarizeEvent(e)}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.id - a.id);
  }, [events, query, roomId, botId, kind]);
  const detail = rows.find((e) => e.id === selected) ?? null;

  function exportRows() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "openag-ledger.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex min-w-0 flex-col" aria-labelledby="ledger-title">
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-2">
        <h1 id="ledger-title" className="m-0 text-2xl font-semibold tracking-tight">Ledger</h1>
        <span className="text-[13px] text-muted-foreground max-[767px]:order-1 max-[767px]:basis-full">Everything every bot did. Append-only.</span>
        <span className="grow" />
        <Button variant="outline" size="sm" type="button" onClick={exportRows} disabled={rows.length === 0}>
          Export
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <label className="sr-only" htmlFor="lq">Search ledger</label>
        <Input id="lq" type="search" placeholder="Search events" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[360px] flex-[1_1_240px]" />
        <label className="sr-only" htmlFor="lroom">Room</label>
        <SelectField id="lroom" value={roomId} onValueChange={(value) => setRoomId(value)} className="w-fit min-w-32">
          <SelectItem value="">All rooms</SelectItem>
          {rooms.map((r) => (
            <SelectItem key={r.id} value={r.id}>#{r.name}</SelectItem>
          ))}
        </SelectField>
        <label className="sr-only" htmlFor="lbot">Bot</label>
        <SelectField id="lbot" value={botId} onValueChange={(value) => setBotId(value)} className="w-fit min-w-32">
          <SelectItem value="">All bots</SelectItem>
          {bots.map((b) => (
            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
          ))}
        </SelectField>
        <ToggleGroup variant="outline" value={[kind]} onValueChange={values => { if(values[0]) setKind(values[0] as Kind); }} className="flex-wrap" aria-label="Event type">{KINDS.map(k=><ToggleGroupItem key={k} value={k}>{k === "all" ? "All" : k}</ToggleGroupItem>)}</ToggleGroup>
      </div>

      {error && <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>Could not load the ledger: {error}</AlertDescription></Alert>}

      <div className="flex min-w-0 flex-col min-[1100px]:flex-row">
        <div className="min-w-0 overflow-x-auto min-[1100px]:flex-1">
          <Table className="w-full min-w-[720px] border-collapse font-mono text-xs leading-[18px]">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground first:pl-5">time</TableHead>
                <TableHead scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground first:pl-5">room</TableHead>
                <TableHead scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground first:pl-5">actor</TableHead>
                <TableHead scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground first:pl-5">type</TableHead>
                <TableHead scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground first:pl-5">summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className={e.id === selected ? "bg-muted" : undefined}>
                  <TableCell className="whitespace-nowrap border-b border-border py-[9px] px-3 align-top text-muted-foreground first:pl-5 !text-muted-foreground">{clock(e.ts)}</TableCell>
                  <TableCell className="border-b border-border py-[9px] px-3 align-top text-muted-foreground first:pl-5">#{roomName(e.roomId)}</TableCell>
                  <TableCell className="border-b border-border py-[9px] px-3 align-top text-muted-foreground first:pl-5">{e.actor}</TableCell>
                  <TableCell><Badge variant={e.type === "error" ? "destructive" : e.type === "approval_requested" ? "attention" : "secondary"}>{e.type}</Badge></TableCell>
                  <TableCell className="border-b border-border py-[9px] px-3 align-top text-muted-foreground first:pl-5">
                    <Button variant="ghost" type="button" className="h-auto w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]" aria-pressed={e.id === selected} onClick={() => setSelected(e.id)}>
                      {(summarizeEvent(e) + routerSuffix(e)) || "(empty)"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && <p className="px-5 py-4 text-muted-foreground">No events match.</p>}
        </div>

        <aside className="flex min-w-0 flex-col gap-3.5 border-t border-border p-5 min-[1100px]:w-[380px] min-[1100px]:flex-[0_0_380px] min-[1100px]:border-l min-[1100px]:border-t-0" aria-label="Event detail">
          {detail ? (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{detail.type}</Badge>
                <span className="font-mono text-xs leading-[18px] text-muted-foreground">#{detail.id} · {clock(detail.ts)}</span>
              </div>
              <p className="m-0 text-[15px] [overflow-wrap:anywhere]">{summarizeEvent(detail)}</p>
              <EvidenceBlock className="my-2.5">{JSON.stringify(detail.payload, null, 2) ?? "null"}</EvidenceBlock>
              <a href={hrefFor({ kind: "room", roomId: detail.roomId })}>Open in #{roomName(detail.roomId)}</a>
            </>
          ) : (
            <p className="text-muted-foreground">Select an event to see its payload.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
