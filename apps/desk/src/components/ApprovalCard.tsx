import { Item, ItemHeader, ItemContent, ItemTitle, ItemDescription, ItemActions } from "./ui/item";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { EvidenceBlock } from "./EvidenceBlock";
import { Disclosure } from "./Disclosure";
import { AvatarPreview } from "./AvatarPreview";
import {useSessionDraft} from "../session-draft";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { hrefFor } from "../route";
import { messageOf } from "../api";
import type { Approval, Decision } from "../types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";

type Mode = "edit" | "respond" | null;

const ACTIONS = "flex flex-wrap gap-2 max-[859px]:grid max-[859px]:grid-cols-[repeat(2,minmax(0,1fr))]";
const REFLECTION_TEXT = "my-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function prettyPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2) ?? "null";
}

export function approvalAction(toolName: string): string {
  const labels: Record<string, string> = {
    write_file: "change a file", memory_append: "add to memory", skill_save: "save a skill",
    reflection_memory: "save a proposed memory", reflection_skill: "save a proposed skill",
    create_work: "create Work", avatar_library_add: "add this avatar to the shared library",
  };
  return Object.hasOwn(labels, toolName) ? labels[toolName]! : `run ${toolName}`;
}

export function ProposalTarget({payload}: {payload: unknown}) {
  const body = isRecord(payload) ? payload : {};
  const targets = ["to", "recipient", "destination", "url", "path", "file_path", "command", "channel"].filter(key => Object.hasOwn(body, key));
  return <dl aria-label="Action target" className="grid gap-2"><div><dt className="text-muted-foreground">Target / affected service or file</dt><dd className="whitespace-pre-wrap break-all">{targets.length ? targets.map(key => `${key}: ${typeof body[key] === "string" ? body[key] : JSON.stringify(body[key])}`).join("\n") : "No explicit target supplied by this tool. Inspect its full payload."}</dd></div></dl>;
}

/** Readable view of a nightly-reflection proposal. Returns null for any other tool or a malformed payload. */
export function reflectionView(toolName: string, payload: unknown): ReactNode | null {
  if (!isRecord(payload)) return null;
  if (toolName === "reflection_memory" && typeof payload.text === "string") {
    return (
      <section aria-label="Proposed memory">
        <h3>Remember this</h3>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>{payload.text}</p>
      </section>
    );
  }
  if (
    toolName === "reflection_skill" &&
    typeof payload.name === "string" &&
    typeof payload.description === "string" &&
    typeof payload.body === "string"
  ) {
    return (
      <section aria-label="Proposed skill">
        <h3>Proposed skill: {payload.name}</h3>
        {typeof payload.slug === "string" && (
          <p data-slot="reflection-text" className={REFLECTION_TEXT}>
            Saved as <code>{payload.slug}</code>
          </p>
        )}
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>{payload.description}</p>
        <EvidenceBlock className="my-2.5 in-data-[slot=approval-detail]:max-h-[440px]">{payload.body}</EvidenceBlock>
      </section>
    );
  }
  if (toolName === "mcp_server_check" && typeof payload.url === "string" && Array.isArray(payload.headers)) {
    const names = payload.headers.flatMap(header => (isRecord(header) && typeof header.name === "string" ? [header.name] : []));
    return (
      <section aria-label="Proposed server check">
        <h3>Check this MCP server</h3>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>
          OpenAg will connect to <code>{payload.url}</code>{typeof payload.serverId === "string" ? <> (server <code>{payload.serverId}</code>)</> : null} and list its tools. Nothing is saved or made available to agents, and approving does not approve any tool the server offers.
        </p>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>
          {names.length ? <>Headers sent: {names.join(", ")} (values come from the daemon's environment and are never shown).</> : "No headers are sent."}
          {payload.allowPrivateNetwork === true ? " Local and private-network addresses are allowed for this check." : null}
        </p>
      </section>
    );
  }
  if (toolName === "mcp_command_review" && isRecord(payload.display) && Array.isArray(payload.display.argv)) {
    const display = payload.display;
    const argv = (Array.isArray(display.argv) ? display.argv : []).filter((part): part is string => typeof part === "string");
    const env = Array.isArray(payload.env) ? payload.env.flatMap(pair => (isRecord(pair) && typeof pair.name === "string" ? [{ name: pair.name, template: typeof pair.template === "string" ? pair.template : "" }] : [])) : [];
    const files = isRecord(payload.review) && Array.isArray(payload.review.files) ? payload.review.files.flatMap(file => (isRecord(file) && typeof file.path === "string" ? [file.path] : [])) : [];
    return (
      <section aria-label="Command to review">
        <h3>Run this command on the OpenAg computer</h3>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>
          Approving saves <code>{String(payload.id)}</code> and lets OpenAg start this program with your user’s permissions whenever the server connects. It is not sandboxed. Any change to it needs a new review.
        </p>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>Program and arguments: <code className="break-all">{argv.map(part => (part === "" || /\s/.test(part) ? JSON.stringify(part) : part)).join(" ")}</code></p>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>Working directory: <code className="break-all">{typeof display.cwd === "string" ? display.cwd : ""}</code></p>
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>
          {env.length ? <>Environment names: {env.map(item => item.name).join(", ")} (set from {env.map(item => item.template).join(", ")}; values are never shown). Nothing else from OpenAg’s environment is passed except PATH, HOME, LANG and TMPDIR.</> : "No environment is passed except PATH, HOME, LANG and TMPDIR."}
        </p>
        {files.length > 0 && <p data-slot="reflection-text" className={REFLECTION_TEXT}>Files whose content is part of this review: <code className="break-all">{files.join(", ")}</code></p>}
        <p data-slot="reflection-text" className={REFLECTION_TEXT}>Review code: <code className="break-all">{typeof display.hash === "string" ? display.hash : ""}</code></p>
      </section>
    );
  }
  return null;
}

/** Human label for a Slack-originated approval source, or null for desk/unknown sources. */
export function slackSourceLabel(source: string | null | undefined): string | null {
  if (typeof source !== "string" || !source.startsWith("slack")) return null;
  const id = source.startsWith("slack:") ? source.slice("slack:".length).trim() : "";
  return id ? `From Slack user ${id}` : "From Slack";
}

export function ApprovalCard({
  approval: a,
  onDecide,
  inline = false,
  botName,
}: {
  approval: Approval;
  onDecide: (id: string, decision: Decision) => Promise<void>;
  /** In the thread: "Waiting for you" header and a plain-English line, as in the design. */
  inline?: boolean;
  botName?: string;
}) {
  const avatarAddition = a.toolName === "avatar_library_add";
  // Only approvals the daemon itself created for the owner (no turn, its own source) read as "you asked"; a lookalike tool name does not.
  const serverCheck = a.toolName === "mcp_server_check" && a.source === "mcp-server-check" && a.turnId === null;
  const commandReview = a.toolName === "mcp_command_review" && a.source === "mcp-command-review" && a.turnId === null;
  const ownerAction = serverCheck || commandReview;
  const payload = useMemo(() => prettyPayload(a.payload), [a.payload]);
  const reflection = useMemo(() => reflectionView(a.toolName, a.payload), [a.toolName, a.payload]);
  const [savedMode,setSavedMode]=useSessionDraft(a.id+":mode");
  const mode:Mode=savedMode==="edit"||savedMode==="respond"?savedMode:null;
  const setMode=(value:Mode)=>setSavedMode(value??"");
  const [draft, setDraft] = useSessionDraft(a.id+":edit");
  const [reply, setReply] = useSessionDraft(a.id+":reply");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalidJson, setInvalidJson] = useState(false);
  const inFlight = useRef(false);

  async function run(decision: Decision) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDecide(a.id, {...decision,reviewVersion:a.reviewVersion});
      setDraft("");setReply("");setMode(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openEdit() {
    if(!draft)setDraft(payload);
    setMode(mode === "edit" ? null : "edit");
  }

  function submitEdit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setInvalidJson(true);
      setError(`Not valid JSON: ${err instanceof Error ? err.message : "parse error"}`);
      return;
    }
    setInvalidJson(false);
    void run({ kind: "edit", payload: parsed });
  }

  function submitReply() {
    if (reply.trim() === "") return;
    void run({ kind: "respond", text: reply });
  }

  const compact = inline && !avatarAddition && !reflection && !ownerAction;
  const Surface = compact ? Item : Card, Header = compact ? ItemHeader : CardHeader;
  const Heading = compact ? ItemTitle : CardTitle, Description = compact ? ItemDescription : CardDescription;
  const Content = compact ? ItemContent : CardContent;
  const actions = <>
        <Button type="button" disabled={busy} onClick={() => void run({ kind: "accept" })}>
          {serverCheck ? "Check server" : commandReview ? "Approve command" : avatarAddition ? "Add to library" : "Accept"}
        </Button>
        {!ownerAction && <Button variant="outline" type="button" aria-expanded={mode === "edit"} disabled={!a.canEdit || busy} onClick={openEdit}>
          Edit
        </Button>}
        {!ownerAction && <Button variant="outline"
          type="button"
          aria-expanded={mode === "respond"}
          disabled={busy}
          onClick={() => setMode(mode === "respond" ? null : "respond")}
        >
          Respond
        </Button>}
        <Button variant="outline" type="button" disabled={busy} onClick={() => void run({ kind: "ignore" })}>
          {serverCheck ? "Cancel check" : commandReview ? "Cancel review" : avatarAddition ? "Keep preview" : "Ignore"}
        </Button></>;

  return (
    <Surface variant={compact ? "outline" : undefined} size="sm" role="article" aria-labelledby={`approval-${a.id}`}>
      <Header>
        <Heading><h2 id={`approval-${a.id}`} className="break-words">{serverCheck ? "You asked OpenAg to check an MCP server" : commandReview ? "You asked OpenAg to review a command" : <>{botName ?? a.botId} wants to {approvalAction(a.toolName)}</>}</h2></Heading>
        <Description className="flex flex-wrap items-center gap-2">{inline && <span>Waiting for you</span>}<Badge variant="outline">{a.toolClass}</Badge></Description>
      </Header>
      <Content className="flex min-w-0 flex-col gap-3">
      {slackSourceLabel(a.source) && <p data-slot="approval-source" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{slackSourceLabel(a.source)}</p>}
      <ProposalTarget payload={a.payload} />
      {avatarAddition ? <AvatarPreview definition={a.review?.avatarDefinition} previewId={isRecord(a.payload) ? String(a.payload.previewId ?? "") : undefined} /> : reflection}
      <Disclosure title="Exact proposal" defaultOpen={!compact && !avatarAddition && !reflection}><EvidenceBlock className="in-data-[slot=approval-detail]:max-h-[440px]">{payload}</EvidenceBlock></Disclosure>
      <ProposalDetails approval={a} />
      {!compact && <div className={ACTIONS}>{actions}</div>}

      {mode === "edit" && (
        <FieldGroup><Field className="mt-2.5 grid gap-2" data-invalid={invalidJson || undefined}>
          <FieldLabel htmlFor={`edit-${a.id}`} className="text-sm text-muted-foreground">Payload (JSON)</FieldLabel>
          <Textarea id={`edit-${a.id}`} rows={8} className="min-h-40" value={draft} disabled={busy} aria-invalid={invalidJson || undefined} onChange={(e) => { setDraft(e.target.value); setInvalidJson(false); setError(null); }} />
          <Button type="button" disabled={busy} onClick={submitEdit}>
            Approve edit
          </Button>
        </Field></FieldGroup>
      )}

      {mode === "respond" && (
        <FieldGroup><Field className="mt-2.5 grid gap-2">
          <FieldLabel htmlFor={`reply-${a.id}`} className="text-sm text-muted-foreground">Reply to the agent instead</FieldLabel>
          <Input id={`reply-${a.id}`} type="text" value={reply} disabled={busy} onChange={(e) => setReply(e.target.value)} />
          <Button type="button" disabled={busy || reply.trim() === ""} onClick={submitReply}>
            Send reply
          </Button>
        </Field></FieldGroup>
      )}

      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}
    </Content>{compact && <ItemActions className={ACTIONS}>{actions}</ItemActions>}</Surface>
  );
}

export function PermissionEvidence({value,pending=false}:{value:unknown;pending?:boolean}) {
  if(!isRecord(value)||!isRecord(value.execution))return null;
  const execution=value.execution,labels:Record<string,string>={'read-only':'Read Only','workspace-write':'Workspace Write','danger-full-access':'Full access (unconfined)','full-access':'Full access'};
  const mode=typeof execution.mode==='string'&&Object.hasOwn(labels,execution.mode)?execution.mode:null;
  if(!mode)return null;
  return <section aria-label={pending?'Proposed execution boundary':'Recorded execution boundary'} className="flex flex-col gap-2 text-sm">
    <h3 className="font-medium">{pending?'Proposed execution boundary':'Recorded execution boundary'}</h3>
    <dl className="flex flex-col gap-2"><div><dt className="text-muted-foreground">Filesystem</dt><dd>{labels[mode]}</dd></div>
      {typeof value.preset==='string'&&<div><dt className="text-muted-foreground">Session selection</dt><dd>{labels[value.preset]??value.preset}{typeof value.revision==='number'?` · revision ${value.revision}`:''}</dd></div>}
      {typeof execution.workspace==='string'&&<div><dt className="text-muted-foreground">Bound workspace</dt><dd className="break-all">{execution.workspace}</dd></div>}
      {Array.isArray(execution.writeRoots)&&execution.writeRoots.length>0&&<div><dt className="text-muted-foreground">Extra write roots</dt><dd className="break-all">{execution.writeRoots.filter(root=>typeof root==='string').join(', ')}</dd></div>}
    </dl>
    {mode==='danger-full-access'&&<Alert variant="destructive"><AlertDescription>Unconfined filesystem execution may read host-readable credentials and cause destructive or remote effects.</AlertDescription></Alert>}
    <p className="text-muted-foreground">{pending?'Acceptance covers this exact operation only. The session mode and future default stay unchanged.':'This is the recorded dispatch boundary. The current session mode may differ.'}</p>
  </section>;
}

export function ProposalDetails({approval:a}:{approval:Approval}) {
  return <section aria-label="Reviewed action" className="flex min-w-0 flex-col gap-3 text-sm">
    {a.status==="pending"&&<PermissionEvidence value={a.review?.permission} pending/>}
    {!a.canEdit && a.toolName !== "mcp_server_check" && a.toolName !== "mcp_command_review" && <p className="text-muted-foreground">This tool cannot validate edits here. Respond to request a new proposal.</p>}
    {Array.isArray(a.review?.nativeFiles)&&a.review.nativeFiles.map((f:any)=><Disclosure key={f.path} title={<>Review file change: {f.path}</>}> <p className="font-medium">Current file</p><EvidenceBlock>{f.before||"New empty file"}</EvidenceBlock><p className="font-medium">Proposed file</p><EvidenceBlock>{f.after===null?"Delete this file":f.after}</EvidenceBlock></Disclosure>)}
    {typeof a.review?.before==="string" && <Disclosure title={<>Current file before this proposal{a.review.beforeTruncated?" (shortened)":""}</>}> <EvidenceBlock>{a.review.before||"New empty file"}</EvidenceBlock><p className="text-muted-foreground">The daemon will refuse the write if this reviewed file changes.</p></Disclosure>}
    <Disclosure title="Review details">
      <dl className="grid gap-2"><div><dt>Tool</dt><dd className="break-all">{a.toolName}</dd></div><div><dt>Review version</dt><dd className="break-all">{a.reviewVersion}</dd></div></dl>
      <div className="mt-3 flex flex-wrap gap-3 text-muted-foreground"><span>Source: {typeof a.review?.requestId==="number"?`message ${a.review.requestId}`:a.source??"Stored approval"}</span>{a.toolCallId&&<span className="break-all">Tool call: {a.toolCallId}</span>}
      {typeof a.review?.workId==="string"&&<a className="underline" href={hrefFor({kind:"work",workId:a.review.workId})}>Related Work</a>}<a className="underline" href={hrefFor({kind:"ledger"})}>Source ledger</a></div>
    </Disclosure>
  </section>;
}
