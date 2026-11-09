import { RecordedFiles, RecordedOutput, RecordedSources } from "./RecordedEvidence";
import { useProfile } from "../profile";
import { useMemo } from "react";
import type { Api } from "../api";
import { RequestDetails } from "./RequestDetails";
import { EvidenceBlock } from "./EvidenceBlock";
import { ReceiptLink } from "./ReceiptView";
import { CircleCheck, CircleDashed, CircleHelp, CircleX, LoaderCircle, Terminal, Wrench } from "lucide-react";
import type { BotInfo, LedgerEvent } from "../types";
import { hrefFor } from "../route";
import { summarizeEvent } from "../ledger";
import { activityItems, type ActivityItem } from "../activity";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "./ui/trace";

export const isActivity = (event: LedgerEvent) => ["mcp_interaction_updated", "turn_started", "tool_call", "tool_result", "approval_decided", "turn_finished", "receipt_updated"].includes(event.type);
const fields = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const turnKey = (event: LedgerEvent) => JSON.stringify([event.roomId, fields(event.payload).turnId ?? `event-${event.id}`]);

function operation(item: ActivityItem, ended: boolean) {
  const p = fields(item.event.payload);
  const call = item.history.find(event => event.type === "tool_call" && typeof fields(event.payload).tool === "string") ?? item.history.find(event => event.type === "tool_call");
  const input = fields(call?.payload), args = fields(input.args ?? input.input);
  const command = args.command ?? fields(args.arguments).command;
  const shell = input.tool === "run_shell" || input.tool === "computer_shell" || input.kind === "execute";
  const unknown = p.executionOutcome === "unknown" || item.event.type === "receipt_updated" && p.outcome === "unknown";
  const failed = !unknown && (p.executionOutcome === "failed" || p.executionOutcome === "not-run" || (!p.executionOutcome && (p.status === "failed" || p.status === "error" || p.ok === false || p.outcome === "failed" || p.outcome === "not-run")));
  const pending = !ended && item.event.type === "tool_call" && p.status === "pending" || p.executionOutcome === "pending" || item.event.type === "receipt_updated" && p.outcome === "pending";
  const running = typeof p.turnId === "string" && !ended && !unknown && !failed && (item.event.type === "tool_call" || item.event.type === "turn_started");
  const missing = (ended || typeof p.turnId !== "string") && item.event.type === "tool_call";
  const status = failed ? "error" as const : pending ? "pending" as const : running ? "running" as const : undefined;
  const label = summarizeEvent(item.event) + (missing ? " · result unavailable" : item.event.type === "approval_decided" ? " · execution tracked separately" : "");
  return { status, unknown: unknown || missing, label,
    title: shell && typeof command === "string" ? `${running ? "Running" : failed ? "Failed to run" : missing ? "Requested" : "Command"}: ${command.slice(0, 200)}` : label,
    Icon: unknown || missing ? CircleHelp : failed ? CircleX : pending ? CircleDashed : running ? LoaderCircle : shell ? Terminal : call ? Wrench : item.event.type === "turn_finished" && p.status === "finished" && p.reason !== "awaiting_input" ? CircleCheck : CircleDashed };
}

export function ActivityTrace({ events, items, bots = [], api, canManage = false }: { api?: Api; canManage?: boolean; events: readonly LedgerEvent[]; items?: readonly ActivityItem[]; bots?: readonly BotInfo[] }) {
  const { profile } = useProfile();
  const projected = useMemo(() => items ?? activityItems(events), [items, events]);
  const visible = new Set(events.map(event => event.id)), groups = new Map<string, ActivityItem[]>();
  for (const item of projected) if (visible.has(item.event.id)) {
    const key = turnKey(item.event), group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  return <Trace aria-label="Agent activity">
    {[...groups].map(([key, group]) => {
      const states = group.map(item => operation(item, !!item.turnEnded));
      const actorId = group.flatMap(item => item.history).find(event => event.type === "turn_started" || event.type === "tool_call")?.actor ?? group[0]!.event.actor;
      const actor = actorId === "user" ? profile.name : bots.find(bot => bot.id === actorId)?.name ?? actorId;
      const operations = group.filter(item => item.history.some(event => event.type === "tool_call")).length;
      const unknown = states.filter(state => state.unknown).length, failed = states.filter(state => state.status === "error").length;
      const status = states.some(state => state.status === "error") ? "error" : states.some(state => state.status === "running") ? "running" : undefined;
      return <TraceCollapsible key={key} defaultOpen={status === "running"}>
        <TraceCollapsibleTrigger><TraceLine status={status}><TraceIcon><Wrench /></TraceIcon><TraceTitle>{actor} · {status === "running" ? "Working" : "Activity"}</TraceTitle><TraceDescription>{operations ? `${operations} operation${operations === 1 ? "" : "s"}` : "Turn updates"}{failed ? ` · ${failed} failed` : ""}{unknown ? ` · ${unknown} unconfirmed` : ""}</TraceDescription></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent><RecordedFiles items={group} /><Trace>
          {group.map((item, index) => {
            const { event, history } = item, payload = fields(event.payload), state = states[index]!;
            const receiptId = payload.receiptId ?? payload.approvalId;
            const line = <TraceLine status={state.status}>
              <TraceIcon><state.Icon /></TraceIcon><TraceTitle title={state.title}>{state.title}</TraceTitle>
              {(state.title !== state.label || state.status === "running" || state.status === "pending") && <TraceDescription>{state.title !== state.label ? state.label : state.status === "running" ? "Running" : "Pending"}</TraceDescription>}
            </TraceLine>;
            return <TraceCollapsible key={event.id}>
              <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                {api && canManage && event.type === "turn_started" && typeof payload.turnId === "string" && <RequestDetails api={api} turnId={payload.turnId} />}
                {typeof payload.interactionId === "string" && <a className="underline" href={hrefFor({ kind: "room", roomId: event.roomId })}>Open conversation for this server request</a>}
                {typeof receiptId === "string" && <ReceiptLink approvalId={receiptId} label="View execution receipt" />}
                {history.some(event => fields(event.payload).detailsTruncated === true) && <p className="mb-2 text-[13px] text-muted-foreground">Showing a shortened event. <a className="underline" href={hrefFor({ kind: "ledger" })}>Open the full ledger</a> for its stored details.</p>}
                <ActivityEvidence event={event} history={history} />
              </TraceCollapsibleContent>
            </TraceCollapsible>;
          })}
        </Trace></TraceCollapsibleContent>
      </TraceCollapsible>;
    })}
  </Trace>;
}

function ActivityEvidence({ event, history }: ActivityItem) {
  const call = history.find(event => event.type === "tool_call" && typeof fields(event.payload).tool === "string") ?? history.find(event => event.type === "tool_call"), input = fields(call?.payload);
  const shell = input.tool === "run_shell" || input.tool === "computer_shell" || input.kind === "execute";
  const result = fields(fields(event.payload).result), stdout = typeof result.stdout === "string" ? result.stdout : "", stderr = typeof result.stderr === "string" ? result.stderr : "";
  return <>
    {input.tool === "brave_search" && <RecordedSources value={fields(event.payload).result} />}
    {shell && <RecordedOutput stdout={stdout} stderr={stderr} />}
    {shell && (stdout || stderr) && <section aria-label="Command output" className="flex min-w-0 flex-col gap-2">
      {stdout && <EvidenceBlock aria-label="Standard output">{stdout}</EvidenceBlock>}
      {stderr && <EvidenceBlock aria-label="Standard error">{stderr}</EvidenceBlock>}
    </section>}
    <EvidenceBlock className="my-2.5">{JSON.stringify(history.length > 1 ? history : event.payload, null, 2)}</EvidenceBlock>
  </>;
}
