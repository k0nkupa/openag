import type { ReactNode } from "react";
import type { Automation, BotInfo, Room } from "../types";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const schedules: Record<string, string> = { "0 9 * * *": "Daily at 09:00", "0 9 * * 1-5": "Weekdays at 09:00", "0 * * * *": "Every hour", "*/15 * * * *": "Every 15 minutes", "0 9 * * 1": "Mondays at 09:00" };
const outcomes: Record<string, string> = { ok: "Succeeded", failed: "Failed", interrupted: "Interrupted", incomplete: "Incomplete", cancelled: "Cancelled", skipped_busy: "Skipped: busy" };
const triggers = { cron: "Schedule", webhook: "Webhook", github: "GitHub", slack: "Slack", github_poll: "GitHub polling" };

export function AutomationsTable({ rows, actions, bots = [], rooms = [] }: { rows: Automation[]; actions: (a: Automation) => ReactNode; bots?: BotInfo[]; rooms?: Room[] }) {
  return <div className="min-w-0 overflow-hidden rounded-xl border border-border"><Table className="min-w-[580px] table-fixed">
    <TableHeader><TableRow><TableHead className="w-[36%]">Automation</TableHead><TableHead className="w-[29%]">Trigger / next run</TableHead><TableHead className="w-[22%]">Last outcome</TableHead><TableHead className="w-[13%] text-right"><span className="sr-only">Enabled and actions</span></TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(a => <TableRow key={a.id}>
      <TableCell className="max-w-72 whitespace-normal align-top"><span className="font-medium">{a.name}</span><p className="m-0 mt-1 text-xs text-muted-foreground">{bots.find(b => b.id === a.botId)?.name ?? a.botId}{a.roomId ? ` · #${rooms.find(r => r.id === a.roomId)?.name ?? a.roomId}` : " · Background"}</p><p className="m-0 mt-2 line-clamp-2 text-sm text-muted-foreground" title={a.prompt}>{a.prompt}</p></TableCell>
      <TableCell className="max-w-64 whitespace-normal align-top"><span>{a.triggerKind === "cron" ? schedules[a.scheduleCron ?? ""] ?? a.scheduleCron : triggers[a.triggerKind]}</span>{a.pollRepo && <p className="m-0 mt-1 text-xs text-muted-foreground">{a.pollRepo}</p>}<p className="m-0 mt-1 text-xs text-muted-foreground">{!a.enabled ? "Paused" : a.runtime?.nextRunAt ? new Date(a.runtime.nextRunAt).toLocaleString(undefined, { timeZone: a.runtime.timezone }) : a.triggerKind === "cron" || a.triggerKind === "github_poll" ? "Schedule unavailable" : "Waiting for an event"}</p>{a.runtime?.timezone && <p className="m-0 mt-1 text-xs text-muted-foreground">{a.runtime.timezone}</p>}{a.enabled && a.runtime?.reason && <p className="m-0 mt-1 text-xs text-muted-foreground">{a.runtime.reason}</p>}{a.runtime?.pollEligibleAt && <p className="m-0 mt-1 text-xs text-muted-foreground">Eligible after {new Date(a.runtime.pollEligibleAt).toLocaleString(undefined, {timeZone:a.runtime.timezone})}</p>}</TableCell>
      <TableCell className="whitespace-normal align-top"><Badge variant={a.lastStatus === "failed" || a.lastStatus === "interrupted" || a.lastStatus === "incomplete" ? "attention" : "outline"}>{a.runtime?.running ? "Running" : a.lastStatus ? outcomes[a.lastStatus] ?? a.lastStatus : "No runs yet"}</Badge>{a.lastRunAt && <p className="m-0 mt-2 text-xs text-muted-foreground">{new Date(a.lastRunAt).toLocaleString()}</p>}{a.lastVerdict && <p className="m-0 mt-1 text-xs text-muted-foreground">Wake decision: {a.lastVerdict}</p>}</TableCell>
      <TableCell className="align-top">{actions(a)}</TableCell>
    </TableRow>)}</TableBody>
  </Table></div>;
}
