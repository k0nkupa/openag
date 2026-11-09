import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { messageOf, type Api } from "../api";
import { mcpHint } from "../mcp-hints";
import type { Approval, Decision, McpCommandReviewDisplay, McpCommandReviewState, McpEntryView, McpSecretView } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

interface Row { key: number; name: string; template: string }
let rowKey = 0;
const toRows = (entry: McpEntryView | undefined): Row[] => (entry?.env ?? []).map(pair => ({ key: ++rowKey, name: pair.name, template: pair.template }));
const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{0,63})\}/g;
const secretNames = (rows: Row[]) => [...new Set(rows.flatMap(row => [...row.template.matchAll(SECRET_REF)].map(match => match[1]!)))];
/** One argument per line; blank lines are ignored. */
const toArgs = (text: string) => text.split("\n").map(line => line.replace(/\r$/, "")).filter(line => line.trim() !== "");

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "review"; approval: Approval; expiresInMs: number; display: McpCommandReviewDisplay }
  | { kind: "waiting" }
  | { kind: "result"; state: McpCommandReviewState };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Add or change a local command server. A command runs on the OpenAg computer, so nothing is saved or started until the exact command
 * is reviewed and approved here. Editing the form drops a proposal in progress: an approval always describes what is on screen.
 */
export function McpCommandDialog({ api, mode, entry, open, onOpenChange, onApplied, returnFocus }: {
  api: Api; mode: "add" | "edit"; entry?: McpEntryView; open: boolean;
  onOpenChange: (open: boolean) => void; onApplied: (id: string) => void | Promise<void>;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const [id, setId] = useState(entry?.id ?? "");
  const [command, setCommand] = useState(entry?.command ?? "");
  const [argsText, setArgsText] = useState((entry?.args ?? []).join("\n"));
  const [rows, setRows] = useState<Row[]>(() => toRows(entry));
  const [offerToAgents, setOfferToAgents] = useState(entry?.offerToAgents ?? true);
  const [timeout, setTimeoutText] = useState(entry && entry.timeoutMs !== 30000 ? String(entry.timeoutMs) : "");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<McpSecretView[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const gone = useRef(false);
  const generation = useRef(0);
  const names = secretNames(rows);
  const serverId = mode === "add" ? id.trim() : entry!.id;
  const named = rows.filter(row => row.name.trim());
  const typedTimeout = timeout.trim() === "" ? undefined : Number(timeout);
  const problem = !command.trim() ? "Enter the program to run."
    : rows.some(row => !row.name.trim() && row.template.trim()) ? "Each environment variable needs a name."
    : new Set(named.map(row => row.name.trim())).size !== named.length ? "Environment names must be different from each other."
    : typedTimeout !== undefined && (!Number.isInteger(typedTimeout) || typedTimeout < 1000 || typedTimeout > 120000) ? "The timeout must be a whole number of milliseconds between 1000 and 120000."
    : mode === "add" && !id.trim() ? "Enter a name." : null;
  const input = problem ? null : {
    id: serverId, command: command.trim(), args: toArgs(argsText), env: Object.fromEntries(named.map(row => [row.name.trim(), row.template])),
    ...(typedTimeout !== undefined ? { timeoutMs: typedTimeout } : mode === "edit" ? { timeoutMs: 30000 } : {}), offerToAgents,
    // An edit keeps a server that was switched off switched off.
    ...(mode === "edit" ? { enabled: entry!.enabled } : {}),
  };
  const key = JSON.stringify(input);
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  // A proposal no longer on screen is withdrawn on the daemon too, so it cannot be accepted later from the Inbox.
  const live = useRef<string | null>(null);
  const withdraw = () => { const id = live.current; live.current = null; if (id) void api.decide(id, { kind: "ignore" }).catch(() => undefined); };
  useEffect(() => { generation.current++; withdraw(); setPhase({ kind: "idle" }); setError(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => withdraw(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === "edit") void api.getMcpSecrets().then(list => { if (!gone.current) setStored(list.secrets.filter(secret => secret.serverId === entry!.id)); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // An unanswered proposal expires on the daemon; show that here instead of a card that can no longer be accepted.
  useEffect(() => {
    if (phase.kind !== "review") return;
    const timer = setTimeout(() => setPhase({ kind: "result", state: { state: "expired" } }), phase.expiresInMs);
    return () => clearTimeout(timer);
  }, [phase]);
  const setRow = (rowId: number, patch: Partial<Row>) => setRows(current => current.map(row => (row.key === rowId ? { ...row, ...patch } : row)));

  async function propose(event?: FormEvent) {
    event?.preventDefault();
    if (!input || phase.kind === "asking") return;
    const mine = ++generation.current;
    setError(null); setPhase({ kind: "asking" });
    try {
      const { approvalId, expiresInMs, review } = await api.proposeMcpCommand(input);
      const { approval } = await api.getApproval(approvalId); if (!approval) throw new Error("The approval is no longer available. Try again.");
      if (!gone.current && mine === generation.current) { live.current = approvalId; setPhase({ kind: "review", approval, expiresInMs, display: review }); }
      else void api.decide(approvalId, { kind: "ignore" }).catch(() => undefined);
    } catch (err) { if (!gone.current && mine === generation.current) { setError(messageOf(err)); setPhase({ kind: "idle" }); } }
  }

  /** The secrets are saved only after the reviewed command exists, and are bound to that exact program and arguments. */
  async function saveSecrets(reviewedHash: string): Promise<string | null> {
    const pending = names.filter(name => typed[name]);
    if (pending.length === 0) return null;
    const review = (await api.getMcpServers()).entries?.servers.find(server => server.id === serverId)?.review;
    // Only the command that was just approved gets these secrets: if another review landed in between, nothing is attached to it.
    const binding = review?.hash === reviewedHash ? review.binding : undefined;
    if (!binding) return "The command was saved, but its secrets could not be stored. Open Edit and enter them again.";
    for (const name of pending) {
      try { await api.setMcpSecret(serverId, name, typed[name]!, `stdio:${binding}`); setTyped(current => { const { [name]: _sent, ...rest } = current; return rest; }); }
      catch (err) { return `The command was saved, but secret ${name} was not: ${messageOf(err)}`; }
    }
    return null;
  }

  async function decide(approvalId: string, display: McpCommandReviewDisplay, decision: Decision) {
    const mine = generation.current;
    live.current = null;
    await api.decide(approvalId, decision);
    if (gone.current || mine !== generation.current) return;
    setPhase({ kind: "waiting" });
    for (let attempt = 0; attempt < 80 && !gone.current && mine === generation.current; attempt++) {
      try {
        const state = await api.getMcpCommandReview(approvalId);
        if (mine !== generation.current) return;
        if (state.state === "done" || state.state === "declined" || state.state === "expired") {
          if (state.state === "done" && state.ok) {
            await onApplied(serverId);
            const secretProblem = await saveSecrets(display.hash);
            if (secretProblem) { setError(secretProblem); setPhase({ kind: "result", state }); return; }
            onOpenChange(false);
            return;
          }
          setPhase({ kind: "result", state }); return;
        }
      } catch (err) { if (mine === generation.current) { setError(messageOf(err)); setPhase({ kind: "idle" }); } return; }
      await sleep(400);
    }
    if (!gone.current && mine === generation.current) { setError("The review is taking longer than expected. Try again."); setPhase({ kind: "idle" }); }
  }

  const busy = phase.kind === "asking" || phase.kind === "waiting";
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-xl" finalFocus={returnFocus}>
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "Add local command" : `Edit ${entry?.id}`}</DialogTitle>
        <DialogDescription>A program that runs on the OpenAg computer. You review the exact command before anything is saved or started.</DialogDescription>
      </DialogHeader>
      <form onSubmit={propose} className="flex min-w-0 flex-col gap-4" aria-label={mode === "add" ? "Add local command" : "Edit local command"}>
        <FieldGroup>
          {mode === "add" && <Field><FieldLabel htmlFor="mcp-command-id">Name</FieldLabel><Input id="mcp-command-id" value={id} placeholder="notes" autoComplete="off" onChange={event => setId(event.target.value)} /><FieldDescription>Lowercase letters, numbers, hyphens and underscores. It cannot be changed later.</FieldDescription></Field>}
          <Field><FieldLabel htmlFor="mcp-command-program">Program</FieldLabel><Input id="mcp-command-program" value={command} placeholder="/usr/local/bin/node" autoComplete="off" onChange={event => setCommand(event.target.value)} /><FieldDescription>A program name found in PATH, or an absolute path. Shells and inline code are not allowed.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="mcp-command-args">Arguments</FieldLabel><Textarea id="mcp-command-args" rows={3} value={argsText} placeholder="/path/to/server.js" onChange={event => setArgsText(event.target.value)} /><FieldDescription>One argument per line. They are passed as they are, with no shell.</FieldDescription></Field>
          <section className="flex min-w-0 flex-col gap-2" aria-label="Environment">
            <div className="flex flex-col gap-1"><h3>Environment</h3><p className="library-meta">Only these variables are passed, besides PATH, HOME, LANG and TMPDIR. A value can be <code>{"${OPENAG_MCP_NAME}"}</code> or a stored secret such as <code>{"${secret:NAME}"}</code>.</p></div>
            {rows.map(row => <div key={row.key} className="flex min-w-0 flex-wrap items-end gap-2">
              <Field className="min-w-32 flex-1"><FieldLabel htmlFor={`mcp-env-name-${row.key}`}>Variable name</FieldLabel><Input id={`mcp-env-name-${row.key}`} value={row.name} placeholder="API_KEY" autoComplete="off" onChange={event => setRow(row.key, { name: event.target.value })} /></Field>
              <Field className="min-w-40 flex-[2]"><FieldLabel htmlFor={`mcp-env-value-${row.key}`}>Reference</FieldLabel><Input id={`mcp-env-value-${row.key}`} value={row.template} placeholder={"${secret:NAME}"} autoComplete="off" onChange={event => setRow(row.key, { template: event.target.value })} /></Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove variable ${row.name || "row"}`} onClick={() => setRows(current => current.filter(other => other.key !== row.key))}><Trash2 aria-hidden="true" /></Button>
            </div>)}
            <div><Button type="button" variant="outline" size="sm" onClick={() => setRows(current => [...current, { key: ++rowKey, name: "", template: "" }])}><Plus data-icon="inline-start" />Add variable</Button></div>
          </section>
          {names.length > 0 && <section className="flex min-w-0 flex-col gap-2" aria-label="Secrets">
            <div className="flex flex-col gap-1"><h3>Secrets</h3><p className="library-meta">Saved encrypted after the command is approved, and never shown again. A secret works only for this exact program and arguments.</p></div>
            {names.map(name => {
              const current = stored.find(secret => secret.name === name && secret.origin === (entry?.review ? `stdio:${entry.review.binding}` : ""));
              return <Field key={name} className="min-w-40"><FieldLabel htmlFor={`mcp-secret-${name}`}>{name}</FieldLabel>
                <Input id={`mcp-secret-${name}`} type="password" autoComplete="new-password" value={typed[name] ?? ""} placeholder={current ? (current.last4 ? `Set, ending ${current.last4}` : "Set") : "Not set"} onChange={event => setTyped(values => ({ ...values, [name]: event.target.value }))} />
                <FieldDescription>{current ? "Leave blank to keep the saved value." : "Enter the value to save with this server."}</FieldDescription></Field>;
            })}
          </section>}
          <Field><FieldLabel htmlFor="mcp-command-timeout">Timeout (milliseconds)</FieldLabel><Input id="mcp-command-timeout" inputMode="numeric" value={timeout} placeholder="30000" autoComplete="off" onChange={event => setTimeoutText(event.target.value)} /><FieldDescription>Optional, between 1000 and 120000. Leave blank for the default.</FieldDescription></Field>
          {mode === "add" && <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="mcp-command-offer">Offer tools to agents</FieldLabel><FieldDescription>Agents can see and request this server’s tools once it is running.</FieldDescription></FieldContent>
            <Switch id="mcp-command-offer" checked={offerToAgents} onCheckedChange={setOfferToAgents} />
          </Field>}
        </FieldGroup>
        {error && <Alert variant="destructive"><AlertDescription><p>{error}</p>{mcpHint(error) && <p>{mcpHint(error)}</p>}</AlertDescription></Alert>}
        <section className="flex min-w-0 flex-col gap-3" aria-label="Command review">
          {(phase.kind === "idle" || phase.kind === "asking" || phase.kind === "result") && <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!input || phase.kind === "asking"}><ShieldCheck data-icon="inline-start" />{phase.kind === "asking" ? "Preparing review…" : phase.kind === "result" ? "Review again" : "Review command"}</Button>
            {problem && <span className="library-meta">{problem}</span>}
          </div>}
          {phase.kind === "review" && <ApprovalCard approval={phase.approval} onDecide={(id, decision) => decide(id, phase.display, decision)} />}
          {phase.kind === "waiting" && <p className="library-meta" role="status">Saving the reviewed command…</p>}
          {phase.kind === "result" && <ReviewResult state={phase.state} />}
        </section>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function ReviewResult({ state }: { state: McpCommandReviewState }) {
  if (state.state === "declined") return <Alert><AlertTitle>Not saved</AlertTitle><AlertDescription>The review was cancelled, so nothing was saved or started.</AlertDescription></Alert>;
  if (state.state === "expired") return <Alert><AlertTitle>Review expired</AlertTitle><AlertDescription>The review was not approved in time. Review again.</AlertDescription></Alert>;
  if (state.state === "done" && !state.ok) return <Alert variant="destructive"><AlertTitle>The command was not saved</AlertTitle><AlertDescription>{state.reason}</AlertDescription></Alert>;
  return null;
}
