import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { useWorkAvatarMood } from "../avatar-activity";
import { cn } from "@/lib/utils";
import { Disclosure } from "./Disclosure";
import { ReceiptLink } from "./ReceiptView";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CircleCheck, CircleDashed, LoaderCircle, Route, X } from "lucide-react";
import { ApiError, messageOf, type Api } from "../api";
import { hrefFor } from "../route";
import { mergeEvents } from "../ledger";
import { useStream } from "../stream";
import { useWorkItem, useWorkList } from "../work-hooks";
import type {
  Approval,
  BotInfo,
  Decision,
  LedgerEvent,
  Room,
  WorkApproval,
  WorkItem,
  WorkRun,
  WorkStatus,
} from "../types";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "./ui/trace";
import { ActivityTrace } from "./ActivityTrace";
import { ApprovalCard } from "./ApprovalCard";
import { BotAvatar } from "./BotAvatar";
import { ComputerView } from "./ComputerView";
import { ResultsPanel } from "./ResultsPanel";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function ReportedPlan({ plan }: { plan: WorkItem["plan"] }) {
  if (!plan.length) return <p className="text-sm text-muted-foreground">No plan reported.</p>;
  const completed = plan.filter(step => step.state === "completed");
  const remaining = plan.filter(step => step.state !== "completed");
  const running = plan.some(step => step.state === "in_progress");
  const steps = (items: WorkItem["plan"]) => <Trace>{items.map((step, index) => <TraceLine key={index} status={step.state === "in_progress" ? "running" : step.state === "pending" ? "pending" : undefined}>
    <TraceIcon>{step.state === "completed" ? <CircleCheck /> : step.state === "in_progress" ? <LoaderCircle /> : <CircleDashed />}</TraceIcon>
    <TraceTitle title={step.title}>{step.title}</TraceTitle><TraceDescription>{step.state === "in_progress" ? "Reported in progress" : step.state === "completed" ? "Reported done" : "Reported pending"}</TraceDescription>
  </TraceLine>)}</Trace>;
  return <Trace aria-label="Reported plan"><TraceCollapsible defaultOpen>
    <TraceCollapsibleTrigger><TraceLine status={running ? "running" : undefined}>
      <TraceIcon><Route /></TraceIcon><TraceTitle>Reported plan</TraceTitle><TraceDescription>{completed.length} of {plan.length} reported done</TraceDescription>
    </TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent><Tabs defaultValue="plan"><TabsList aria-label="Reported plan view"><TabsTrigger value="plan">Plan</TabsTrigger><TabsTrigger value="queue">Queue</TabsTrigger></TabsList>
      <TabsContent value="plan">{steps(plan)}</TabsContent>
      <TabsContent value="queue"><h4 className="my-2 text-sm font-medium">To do · {remaining.length}</h4>{steps(remaining)}<h4 className="my-2 text-sm font-medium">Completed · {completed.length}</h4>{steps(completed)}</TabsContent>
    </Tabs></TraceCollapsibleContent>
  </TraceCollapsible></Trace>;
}

export const WORK_LABELS: Record<WorkStatus, string> = {
  working: "Working",
  needs_input: "Needs input",
  needs_approval: "Needs approval",
  completed: "Completed",
  incomplete: "Incomplete",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
};
export function WorkBadge({ item }: { item: WorkItem }) {
  return (
    <Badge
      variant={
        item.status === "completed"
          ? "success"
          : item.status === "failed"
            ? "destructive"
            : ["needs_input", "needs_approval"].includes(item.status)
              ? "attention"
              : "outline"
      }
    >
      {item.readyToStart ? "Ready to start" : WORK_LABELS[item.status]}
    </Badge>
  );
}
const botName = (id: string, bots: readonly BotInfo[]) =>
  bots.find((bot) => bot.id === id)?.name ?? id;
const roomName = (id: string, rooms: readonly Room[]) =>
  rooms.find((room) => room.id === id)?.name ?? id;

export function WorkCard({
  item,
  bots,
  rooms,
  onSelect,
  compact = false,
}: {
  item: WorkItem;
  bots: readonly BotInfo[];
  rooms: readonly Room[];
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const bot = bots.find((bot) => bot.id === item.botId);
  const avatarMood = useWorkAvatarMood(item);
  return (
    <Card size="sm" role="article" aria-label={`Work: ${item.title}`} data-work-id={item.id}
      className={cn(!compact && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_auto] md:items-center md:gap-x-4")}>
      <CardHeader>
        <CardTitle><h3 className="break-words">{item.title}</h3></CardTitle>
        <CardDescription className="break-words">{item.nextStep}</CardDescription>
        {item.cancelRequestedAt && item.status !== "cancelled" && <p role="status">Cancellation requested · waiting for execution to settle</p>}
        {item.continuedFrom && <a className="underline" href={hrefFor({kind:"work",workId:item.continuedFrom})}>Earlier attempt</a>}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><BotAvatar name={item.botId} avatar={bot?.avatar} size={20} mood={avatarMood} /><span className="break-words">{botName(item.botId, bots)}</span><span className="break-words text-muted-foreground">· {roomName(item.roomId, rooms)}</span></div>
        <WorkBadge item={item} />
      </CardContent>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 md:flex-col md:items-end">
        <time className="text-xs text-muted-foreground" title={new Date(item.updatedAt).toLocaleString()} dateTime={new Date(item.updatedAt).toISOString()}>Updated {new Date(item.updatedAt).toLocaleString(undefined, {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</time>
        <Button variant="ghost" onClick={() => onSelect(item.id)}>View Work<ArrowUpRight data-icon="inline-end" /></Button>
      </CardContent>
    </Card>
  );
}

function WorkActivity({
  api,
  id,
  computerOnly = false,
}: {
  api: Api;
  id: string;
  computerOnly?: boolean;
}) {
  const [canManage,setCanManage]=useState(false);
  useEffect(()=>{let active=true;void api.whoami().then(p=>{if(active)setCanManage(p.kind==='owner'||p.access==='full');}).catch(()=>{});return()=>{active=false;};},[api]);
  const { subscribe } = useStream();
  const [events, setEvents] = useState<LedgerEvent[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true);
  const controls = useRef({ load: (_older: boolean) => {} });
  useEffect(() => {
    let active = true,
      fetching = false,
      queued = false,
      initialized = false,
      newest = 0,
      next: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setEvents([]);
    setCursor(null);
    setError(undefined);
    setLoading(true);
    async function load(older = false) {
      if (fetching) {
        queued = true;
        return;
      }
      fetching = true;
      setLoading(true);
      try {
        if (!initialized || older) {
          const page = await api.getWorkActivity(
            id,
            older && next !== null ? next : undefined,
          );
          if (!active) return;
          setEvents((old) => mergeEvents(old, page.events));
          next = page.nextCursor;
          setCursor(next);
          newest = Math.max(newest, ...page.events.map((e) => e.id));
          initialized = true;
        } else {
          let after = newest;
          for (;;) {
            const page = await api.getWorkActivity(id, undefined, after);
            if (!active) return;
            setEvents((old) => mergeEvents(old, page.events));
            newest = Math.max(newest, ...page.events.map((e) => e.id));
            if (page.nextCursor === null) break;
            after = page.nextCursor;
          }
        }
        if (active) setError(undefined);
      } catch (err) {
        if (active) setError(messageOf(err));
      } finally {
        fetching = false;
        if (active) {
          setLoading(false);
          if (queued) {
            queued = false;
            schedule();
          }
        }
      }
    }
    function schedule() {
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, 750);
    }
    controls.current = { load: (older) => void load(older) };
    void load();
    const off = subscribe({
      onOpen: () => void load(),
      onEvent: (event) => {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        if (event.type === "work_updated" && payload.workId === id) {
          if (fetching) queued = true;
          else schedule();
        }
      },
    });
    return () => {
      active = false;
      clearTimeout(timer);
      off();
      controls.current = { load: () => {} };
    };
  }, [api, id, subscribe]);
  const visible = events.filter((event) => {
    if (
      ![
        "turn_started",
        "turn_finished",
        "tool_call",
        "tool_result",
        "approval_requested",
        "approval_decided",
        "error",
        "bot_output",
        "result_saved",
      ].includes(event.type)
    )
      return false;
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    return (
      !computerOnly ||
      (typeof payload.tool === "string" && payload.tool.startsWith("computer_"))
    );
  });
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={computerOnly ? "Linked computer activity" : "Work activity"}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => controls.current.load(false)}
            >
              Retry activity
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {visible.length ? (
        <ActivityTrace api={api} canManage={canManage} events={visible} />
      ) : (
        <p
          className="text-[13px] text-muted-foreground"
          role={loading ? "status" : undefined}
        >
          {loading
            ? "Loading activity…"
            : computerOnly
              ? "No computer events in the loaded activity."
              : "No execution activity in the loaded page."}
        </p>
      )}
      {cursor !== null && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => controls.current.load(true)}
        >
          Older activity
        </Button>
      )}
    </section>
  );
}

function WorkOverview({
  api,
  item,
  bots,
  rooms,
  approvals,
  onDecide,
  onChanged,
}: {
  api: Api;
  item: WorkItem;
  bots: readonly BotInfo[];
  rooms: readonly Room[];
  approvals: readonly Approval[];
  onDecide: (id: string, decision: Decision) => Promise<void>;
  onChanged: (item: WorkItem) => void;
}) {
  const [runs, setRuns] = useState<WorkRun[]>([]),
    [links, setLinks] = useState<WorkApproval[]>([]),
    [runCursor, setRunCursor] = useState<number | null>(null),
    [approvalCursor, setApprovalCursor] = useState<number | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const cancelling = useRef(false);
  const generation = useRef(0);
  const oldestApproval = useRef(Infinity);
  const [retry, setRetry] = useState(0);
  const [linksLoading, setLinksLoading] = useState(true);
  const { subscribe } = useStream();
  const children = useWorkList(api, { parentId: item.id });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer === undefined) timer = setTimeout(() => {
        timer = undefined;
        setRetry(value => value + 1);
      }, 500);
    };
    const off = subscribe({
      onOpen: refresh,
      onEvent: event => {
        if (event.roomId === item.roomId &&
          (event.type === "approval_requested" || event.type === "approval_decided")) refresh();
      },
    });
    return () => { clearTimeout(timer); off(); };
  }, [subscribe, item.id, item.roomId]);
  useEffect(() => {
    let active = true;
    generation.current++;
    setLinksLoading(true);
    async function approvalPages() {
      const rows: WorkApproval[] = [];
      let before: number | undefined;
      while (active) {
        const page = await api.getWorkApprovals(item.id, before);
        rows.push(...page.approvals);
        if (page.nextCursor === null || page.nextCursor <= oldestApproval.current)
          return { approvals: rows, nextCursor: page.nextCursor };
        before = page.nextCursor;
      }
      return { approvals: rows, nextCursor: null };
    }
    void Promise.all([api.getWorkRuns(item.id), approvalPages()])
      .then(([r, a]) => {
        if (active) {
          setRuns(r.runs);
          setLinks(a.approvals);
          oldestApproval.current = Math.min(oldestApproval.current, a.approvals.at(-1)?.cursor ?? Infinity);
          setRunCursor(r.nextCursor);
          setApprovalCursor(a.nextCursor);
          setError(undefined);
        }
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      })
      .finally(() => {
        if (active) setLinksLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [
    api,
    retry,
    item.id,
    item.status,
    item.progress.turns,
    item.progress.finishedTurns,
  ]);
  async function cancel() {
    if (cancelling.current) return;
    cancelling.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.cancelWork(item.id, item.revision);
      onChanged(response.work);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Work changed. Review its current state before cancelling again."
          : messageOf(err),
      );
      try {
        onChanged((await api.getWork(item.id)).work);
      } catch {
        /* Keep the explicit error if the daemon is unavailable. */
      }
    } finally {
      cancelling.current = false;
      setBusy(false);
    }
  }
  async function more(kind: "runs" | "approvals") {
    if (busy || linksLoading) return;
    setBusy(true);
    const current = generation.current;
    try {
      if (kind === "runs" && runCursor !== null) {
        const page = await api.getWorkRuns(item.id, runCursor);
        if (current !== generation.current) return;
        setRuns((old) => [
          ...old,
          ...page.runs.filter((row) => !old.some((r) => r.id === row.id)),
        ]);
        setRunCursor(page.nextCursor);
      }
      if (kind === "approvals" && approvalCursor !== null) {
        const page = await api.getWorkApprovals(item.id, approvalCursor);
        if (current !== generation.current) return;
        setLinks((old) => [
          ...old,
          ...page.approvals.filter((row) => !old.some((r) => r.id === row.id)),
        ]);
        oldestApproval.current = Math.min(oldestApproval.current, page.approvals.at(-1)?.cursor ?? Infinity);
        setApprovalCursor(page.nextCursor);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  const canCancel = [
    "working",
    "needs_input",
    "needs_approval",
    "interrupted",
  ].includes(item.status);
  return (
    <div className="flex min-w-0 flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <WorkBadge item={item} />
        <span className="text-[13px] text-muted-foreground">
          {botName(item.botId, bots)} · {roomName(item.roomId, rooms)}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words">{item.request}</p>
      {item.explicit && item.originMessageId && <p className="text-muted-foreground">Created from conversation message {item.originMessageId}. Creation does not approve later actions.</p>}
      {item.readyToStart && <Button className="self-start" disabled={busy} onClick={()=>{if(busy)return;setBusy(true);setError(undefined);void api.startWork(item.id,item.revision).then(value=>onChanged(value.work)).catch(error=>setError(messageOf(error))).finally(()=>setBusy(false));}}>{busy?'Starting…':'Start Work'}</Button>}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Next step</h3>
        <p className="break-words text-muted-foreground">{item.nextStep}</p>
      </section>
      {["failed", "interrupted", "incomplete"].includes(item.status) && (
        <Alert variant={item.status === "failed" ? "destructive" : "default"}>
          <AlertDescription>
            Review the recorded outcome before continuing. Existing results are
            kept.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetry((value) => value + 1)}
            >
              Refresh Work links
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {item.cancelRequestedAt && item.status !== "cancelled" && (
        <p role="status">
          Cancellation requested. Waiting for confirmed execution to settle.
        </p>
      )}
      {canCancel && (
        <Button
          variant="outline"
          disabled={busy || !!item.cancelRequestedAt}
          onClick={() => void cancel()}
        >
          <X data-icon="inline-start" />
          {busy ? "Requesting cancellation…" : "Cancel Work"}
        </Button>
      )}
      <Button
        variant="ghost"
        nativeButton={false} render={<a href={hrefFor({ kind: "room", roomId: item.roomId })} />}
      >
        Open conversation
        <ArrowUpRight data-icon="inline-end" />
      </Button>
      <section className="flex flex-col gap-3" aria-label="Linked approvals">
        <h3 className="font-medium">Approvals</h3>
        {links.map((link) => {
          const pending = approvals.find((a) => a.id === link.id);
          return pending ? (
            <ApprovalCard
              key={link.id}
              approval={pending}
              onDecide={onDecide}
              botName={botName(pending.botId, bots)}
              inline
            />
          ) : (
            <p
              key={link.id}
              className="break-all text-[13px] text-muted-foreground"
            >
              <ReceiptLink approvalId={link.id} label={`${link.status} · View decision and execution receipt`}/>
            </p>
          );
        })}
        {!links.length && !linksLoading && !error && (
          <p className="text-[13px] text-muted-foreground">
            No linked approvals.
          </p>
        )}
        {approvalCursor !== null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void more("approvals")}
          >
            Older approvals
          </Button>
        )}
      </section>
      <Disclosure title="Execution details">
        <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Recorded execution</h3>
        <p className="text-[13px] text-muted-foreground">
          {item.progress.finishedTurns ?? 0} of {item.progress.turns ?? 0} turns
          finished · {item.progress.completedTools ?? 0} successful tool
          outcomes · {item.progress.pendingTools ?? 0} pending ·{" "}
          {item.progress.unsuccessfulTools ?? 0} unsuccessful · {item.progress.unknownTools ?? 0} unknown
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Reported plan</h3>
        <p className="text-[13px] text-muted-foreground">
          Agent-reported steps are separate from confirmed execution.
        </p>
        <ReportedPlan plan={item.plan} />
      </section>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt>Work ID</dt><dd className="break-all">{item.id}</dd>
          <dt>Created</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd>
          <dt>Updated</dt><dd>{new Date(item.updatedAt).toLocaleString()}</dd>
        </dl>
        </div>
      </Disclosure>
      <Disclosure title="Turn history">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Turns</h3>
        {runs.map((run) => (
          <Card
            key={run.id}

          ><CardContent className="flex min-w-0 flex-col gap-3">
            <p className="break-all">{run.turnId ?? "Queued turn"}</p>
            <p className="text-muted-foreground">
              {run.status === "draining"
                ? "Waiting for delegated results"
                : run.status}
              {run.reason ? ` · ${run.reason}` : ""}
            </p>
          </CardContent></Card>
        ))}
        {runCursor !== null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void more("runs")}
          >
            Older turns
          </Button>
        )}
      </section>
      </Disclosure>
      <section className="flex flex-col gap-3" aria-label="Delegated Work">
        <h3 className="font-medium">Delegated Work</h3>
        {children.error && <Alert variant="destructive"><AlertDescription>{children.error}</AlertDescription></Alert>}
        <Trace aria-label="Delegated runs">{children.items.map(child => <TraceCollapsible key={child.id}>
          <TraceCollapsibleTrigger><TraceLine status={child.status === "failed" ? "error" : child.status === "working" && !child.readyToStart ? "running" : undefined}>
            <TraceIcon><Route /></TraceIcon><TraceTitle title={child.title}>{botName(child.botId, bots)} · {child.title}</TraceTitle><WorkBadge item={child} />
          </TraceLine></TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="flex flex-col gap-3">
            <Button variant="ghost" nativeButton={false} render={<a href={hrefFor({ kind: "work", workId: child.id })} />}>Open delegated Work<ArrowUpRight data-icon="inline-end" /></Button>
            <ReportedPlan plan={child.plan} />
            <WorkActivity api={api} id={child.id} />
          </TraceCollapsibleContent>
        </TraceCollapsible>)}</Trace>
        {!children.items.length && !children.loading && (
          <p className="text-[13px] text-muted-foreground">
            No delegated Work.
          </p>
        )}
        {children.cursor !== null && (
          <Button
            variant="outline"
            disabled={children.loading}
            onClick={children.more}
          >
            Older delegated Work
          </Button>
        )}
      </section>
    </div>
  );
}

export function WorkInspector({
  api,
  item,
  bots,
  rooms,
  approvals,
  onDecide,
  onChanged,
  empty,
  scope,
  active = true,
  extraTabs,
  tab,
  onTabChange,
}: {
  api: Api;
  item?: WorkItem;
  bots: readonly BotInfo[];
  rooms: readonly Room[];
  approvals: readonly Approval[];
  onDecide: (id: string, decision: Decision) => Promise<void>;
  onChanged: (item: WorkItem) => void;
  empty?: ReactNode;
  scope?: { roomId?: string; botId?: string };
  active?: boolean;
  tab?: string;
  onTabChange?: (value: string) => void;
  /** Tabs added after the standard four, e.g. room settings. An `icon` makes the trigger icon-only (the label stays its accessible name). */
  extraTabs?: { value: string; label: string; icon?: ReactNode; content: ReactNode }[];
}) {
  return (
    <Tabs defaultValue="work" value={tab} onValueChange={onTabChange} className="flex min-w-0 flex-col gap-6">
      <TabsList variant="line" className="h-auto! min-h-11 w-full shrink-0" aria-label="Work context">
        {["work", "files", "computer", "activity"].map((tab) => (
          <TabsTrigger
            className="min-h-11 px-2 text-[13px]"
            key={tab}
            value={tab}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
          </TabsTrigger>
        ))}
        {extraTabs?.map((tab) => (
          <TabsTrigger className="min-h-11 flex-none px-3 text-[13px]" key={tab.value} value={tab.value} aria-label={tab.icon ? tab.label : undefined}>
            {tab.icon ?? tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="work" keepMounted>
        {item ? (
          <WorkOverview
            key={item.id}
            api={api}
            item={item}
            bots={bots}
            rooms={rooms}
            approvals={approvals}
            onDecide={onDecide}
            onChanged={onChanged}
          />
        ) : (
          (empty ?? (
            <p className="text-sm text-muted-foreground">
              Select Work to see its next step and recorded progress.
            </p>
          ))
        )}
      </TabsContent>
      <TabsContent value="files">
        {item ? (
          <ResultsPanel key={item.id} api={api} workId={item.id} />
        ) : scope ? (
          <ResultsPanel api={api} roomId={scope.roomId} botId={scope.botId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Select Work to see its saved results.
          </p>
        )}
      </TabsContent>
      <TabsContent value="computer">
        <ComputerView api={api} compact enabled={active} />
        {item && (
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-medium">
              Recorded use by this Work
            </h3>
            <WorkActivity key={item.id} api={api} id={item.id} computerOnly />
          </div>
        )}
      </TabsContent>
      <TabsContent value="activity" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-medium">Activity</h3>
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href={hrefFor({ kind: "ledger" })} />}>
            Full ledger<ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
        {item ? (
          <WorkActivity key={item.id} api={api} id={item.id} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Select Work to see its linked activity.
          </p>
        )}
      </TabsContent>
      {extraTabs?.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} keepMounted>{tab.content}</TabsContent>
      ))}
    </Tabs>
  );
}

export function WorkPage({
  api,
  workId,
  bots,
  rooms,
  approvals,
  onDecide,
}: {
  api: Api;
  workId?: string;
  bots: readonly BotInfo[];
  rooms: readonly Room[];
  approvals: readonly Approval[];
  onDecide: (id: string, decision: Decision) => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState<WorkStatus | undefined>();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const list = useWorkList(api, { q: search || undefined, status });
  const selected = useWorkItem(api, workId);
  const select = (id?: string) => {
    window.location.hash = hrefFor({ kind: "work", workId: id });
  };
  return (
    <Sheet
      open={!!workId}
      onOpenChange={(open) => {
        if (!open) select();
      }}
    >
      <section
        className="flex min-w-0 flex-col gap-6"
        aria-labelledby="work-page-title"
      >
        <header>
          <h1 id="work-page-title">Work</h1>
          <p className="text-sm text-muted-foreground">
            Every request has an owner, a next step and a place for its results.
          </p>
        </header>
        <Input
          aria-label="Search Work"
          placeholder="Find Work, an agent or a room…"
          maxLength={300}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2" aria-label="Filter Work state">
          {[undefined, ...(Object.keys(WORK_LABELS) as WorkStatus[])].map(
            (state) => (
              <Button
                key={state ?? "all"}
                size="sm"
                variant={status === state ? "secondary" : "ghost"}
                aria-pressed={status === state}
                onClick={() => setStatus(state)}
              >
                {state ? WORK_LABELS[state] : "All states"}
              </Button>
            ),
          )}
        </div>
        {list.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {list.error}
              <Button variant="outline" size="sm" onClick={list.refresh}>
                Retry Work
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {list.loading && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Updating Work…
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {list.items.map((item) => (
            <WorkCard
              key={item.id}
              item={item}
              bots={bots}
              rooms={rooms}
              onSelect={select}
            />
          ))}
        </div>
        {!list.items.length && !list.loading && !list.error && (
          <p className="text-sm text-muted-foreground">
            {search || status
              ? "No matching Work. Try another search or state."
              : "No Work yet. Accepted Work proposals will appear here."}
          </p>
        )}
        {list.cursor !== null && (
          <Button variant="outline" disabled={list.loading} onClick={list.more}>
            Older Work
          </Button>
        )}
      </section>
      <SheetContent size="wide" className="overflow-auto">
        <SheetHeader>
          <SheetTitle className="break-words">
            {selected.item?.title ?? "Work details"}
          </SheetTitle>
          <SheetDescription>
            {selected.item
              ? `${botName(selected.item.botId, bots)} · ${roomName(selected.item.roomId, rooms)}`
              : "Review progress, saved results and linked activity."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-w-0 p-4">
          {selected.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {selected.error}
                <Button variant="outline" size="sm" onClick={selected.refresh}>
                  Retry details
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {selected.loading ? (
            <p role="status">Loading Work…</p>
          ) : (
            selected.item && (
              <WorkInspector
                api={api}
                item={selected.item}
                bots={bots}
                rooms={rooms}
                approvals={approvals}
                onDecide={onDecide}
                onChanged={selected.apply}
              />
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
