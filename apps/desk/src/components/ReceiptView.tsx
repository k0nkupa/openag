import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { EvidenceBlock } from "./EvidenceBlock";
import { Disclosure } from "./Disclosure";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { messageOf } from "../api";
import { hrefFor } from "../route";
import { useStream } from "../stream";
import { useUnsavedChanges } from "../unsaved-changes";
import type { ActionReceipt, Approval, Decision } from "../types";
import { ApprovalCard, prettyPayload, ProposalDetails, ProposalTarget, PermissionEvidence, approvalAction } from "./ApprovalCard";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

const outcomeLabel: Record<ActionReceipt["outcome"], string> = {
  pending: "Pending execution evidence", completed: "Completed", failed: "Failed", unknown: "Outcome unknown", "not-run": "Not run",
};
const decisionLabel: Record<Exclude<Approval["status"], "pending">, string> = {
  edited: "Accepted with your edit", accepted: "Accepted", responded: "Responded", ignored: "Ignored",
};
export function ReceiptLink({approvalId, label = "View decision and execution receipt"}: {approvalId: string; label?: string}) {
  return <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={hrefFor({kind: "approval", approvalId})}>{label}</a>;
}
export function ReceiptPage({api, approvalId, onDecide, compact = false}: {api: Api; approvalId: string; compact?: boolean; onDecide: (id: string, decision: Decision) => Promise<void>}) {
  const {subscribe} = useStream();
  const [data, setData] = useState<{approval: Approval | null; receipt: ActionReceipt | null}>();
  const [loadError, setLoadError] = useState<string>(), [inspectionError, setInspectionError] = useState<string>();
  const [note, setNote] = useState(""), [reference, setReference] = useState(""), [saving, setSaving] = useState(false);
  const inspectionPending = useRef(false), currentId = useRef(approvalId), controls = useRef(() => {});
  currentId.current = approvalId;
  useUnsavedChanges(Boolean(note || reference), saving);
  useEffect(() => {
    let active = true, fetching = false, queued = false, timer: ReturnType<typeof setTimeout> | undefined;
    setData(undefined); setLoadError(undefined); setInspectionError(undefined); setNote(""); setReference(""); setSaving(false); inspectionPending.current = false;
    const schedule = () => { if (timer === undefined) timer = setTimeout(() => { timer = undefined; void load(); }, 300); };
    async function load() {
      if (fetching) { queued = true; return; } fetching = true;
      try { const next = await api.getApproval(approvalId); if (active) { setData(next); setLoadError(undefined); } }
      catch (err) { if (active) setLoadError(messageOf(err)); }
      finally { fetching = false; if (active && queued) { queued = false; schedule(); } }
    }
    controls.current = () => void load(); void load();
    const off = subscribe({onOpen: schedule, onEvent: event => {
      const payload = event.payload as {approvalId?: string; receiptId?: string} | null;
      if ((event.type === "receipt_updated" || event.type === "approval_decided") && (payload?.receiptId ?? payload?.approvalId) === approvalId) schedule();
    }});
    return () => { active = false; clearTimeout(timer); off(); controls.current = () => {}; };
  }, [api, approvalId, subscribe]);
  async function inspect() {
    if (!data?.receipt || inspectionPending.current) return;
    inspectionPending.current = true; setSaving(true); setInspectionError(undefined);
    try {
      const {receipt} = await api.inspectReceipt(approvalId, {reviewVersion: data.receipt.reviewVersion, note, reference});
      if (currentId.current === approvalId) {
        setData(current => current && (current.receipt?.id ?? current.approval?.id) === approvalId ? {...current, receipt} : current);
        setNote(""); setReference(""); controls.current();
      }
    } catch (err) { if (currentId.current === approvalId) setInspectionError(messageOf(err)); }
    finally { if (currentId.current === approvalId) { inspectionPending.current = false; setSaving(false); } }
  }
  const a = data?.approval, r = data?.receipt, Heading = compact ? "h2" : "h1";
  const legacyEdit = !r && a?.status === "edited" && Object.hasOwn(a, "edit") && a.edit != null;
  const effective = r ? r.effective : legacyEdit ? a?.edit : a?.payload;
  return <section className={`mx-auto flex w-full max-w-4xl flex-col gap-5 ${compact ? "" : "p-5 sm:p-8"}`} aria-label="Decision and execution">
    <header><Heading className="text-2xl font-semibold">{a?.status === "pending" ? "Review action" : "Action receipt"}</Heading></header>
    {loadError && <Alert variant="destructive"><AlertDescription>Could not load this receipt: {loadError} <Button variant="outline" onClick={() => controls.current()}>Retry receipt</Button></AlertDescription></Alert>}
    {!data && !loadError && <p role="status">Loading decision…</p>}
    {(a || r) && <>
      {a?.status !== "pending" && <p className="break-words">Action: {approvalAction(a?.toolName ?? r!.toolName)}</p>}
      {a?.status === "pending" ? <ApprovalCard approval={a} onDecide={async (id, decision) => { await onDecide(id, decision); controls.current(); }} /> : <>
        {(r || a?.status !== "edited" || legacyEdit) && <ProposalTarget payload={effective} />}
        <Card size="sm" role="region" aria-label="Decision receipt">
          <CardHeader><CardTitle><h2>{a ? "Your decision" : "Automatically authorized; no human approval"}</h2></CardTitle><CardDescription>{a ? decisionLabel[a.status] : "Authorized by the session mode"}</CardDescription></CardHeader>
          {a?.responseText && <CardContent><p className="whitespace-pre-wrap">Your response: {a.responseText}</p></CardContent>}
        </Card>
        <Card size="sm" role="region" aria-label="Execution outcome">
          <CardHeader><CardTitle><h2>{r?.evidence.effectVerification ? "Tool result" : "Execution outcome"}</h2></CardTitle><CardAction><Badge variant={!r ? "attention" : r.outcome === "failed" || r.outcome === "not-run" ? "destructive" : r.outcome === "unknown" || r.outcome === "pending" ? "attention" : r.outcome === "completed" ? "success" : "outline"}>{r?.evidence.effectVerification && r.outcome === "completed" ? "Succeeded" : r ? outcomeLabel[r.outcome] : "Unconfirmed"}</Badge></CardAction></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {r ? <>
              {r.evidence.detail && <p className="whitespace-pre-wrap break-words">{r.evidence.detail}</p>}
              {r.evidence.effectVerification === "not-checked" && <p>External change verification: Not checked</p>}
              {r.evidence.reference && <p className="break-all">Evidence reference: {r.evidence.reference}</p>}
              {r.outcome === "unknown" && <>
                <Alert><AlertDescription>The action may already have happened. Inspect the target and linked activity before a fresh proposal. This action will not be replayed automatically.</AlertDescription></Alert>
                {r.inspectedAt ? <section aria-label="Recorded target inspection" className="flex flex-col gap-2">
                  <h3 className="font-medium">Owner inspected the target</h3>
                  <p>Recorded {new Date(r.inspectedAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{r.inspection?.note}</p><p className="break-all">Inspection reference: {r.inspection?.reference}</p>
                  <p className="text-muted-foreground">The original outcome remains unknown. A new operation must follow the current permission mode; nothing was replayed.</p>
                </section> : <section aria-label="Record target inspection" className="flex flex-col gap-3">
                  <h3 className="font-medium">Inspect before a new proposal</h3>
                  <p>Check the service or files, then record what you found. Owner or Full access is required. Recording this check expires older pending external proposals; it does not confirm success or repeat the action.</p>
                  <FieldGroup>
                    <Field><FieldLabel htmlFor={`inspection-reference-${approvalId}`}>Target or evidence reference (without credentials)</FieldLabel><Input id={`inspection-reference-${approvalId}`} maxLength={300} value={reference} onChange={event => setReference(event.target.value)} disabled={saving} /></Field>
                    <Field><FieldLabel htmlFor={`inspection-note-${approvalId}`}>What did you inspect and find?</FieldLabel><Textarea id={`inspection-note-${approvalId}`} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} disabled={saving} /></Field>
                  </FieldGroup>
                  {inspectionError && <Alert variant="destructive"><AlertDescription>Could not record inspection: {inspectionError}</AlertDescription></Alert>}
                  <Button variant="outline" disabled={saving || reference.trim().length < 3 || note.trim().length < 10} onClick={() => void inspect()}>{saving ? "Recording inspection…" : "Record inspection"}</Button>
                </section>}
              </>}
            </> : <p>No durable execution receipt exists for this older approval. Its decision is not evidence of success.</p>}
          </CardContent>
        </Card>
        <Disclosure defaultOpen title={r?.decision === "edited" || legacyEdit ? "Exact edited payload" : !r && a?.status === "edited" ? "Original proposal" : r?.decision === "automatic" ? "Exact executed payload" : "Exact reviewed payload"}>{!r && a?.status === "edited" && !legacyEdit && <p>The accepted edit is unavailable in this receipt. Only the original proposal is retained here.</p>}<EvidenceBlock>{prettyPayload(effective)}</EvidenceBlock></Disclosure>
        {(r?.decision === "edited" || legacyEdit) && <Disclosure title="Original proposal"><EvidenceBlock>{prettyPayload(r ? r.proposal : a?.payload)}</EvidenceBlock></Disclosure>}
        {r && <PermissionEvidence value={r.permission} />}
        <Disclosure title="Receipt details">
          <div className="flex min-w-0 flex-col gap-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2"><dt>Agent ID</dt><dd className="break-all">{a?.botId ?? r?.botId}</dd><dt>Conversation ID</dt><dd className="break-all">{a?.roomId ?? r?.roomId}</dd></dl>
            {r && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt>Decision recorded</dt><dd>{new Date(r.decidedAt).toLocaleString()}</dd>
              {r.startedAt && <><dt>Execution started</dt><dd>{new Date(r.startedAt).toLocaleString()}</dd></>}
              {r.finishedAt && <><dt>Outcome recorded</dt><dd>{new Date(r.finishedAt).toLocaleString()}</dd></>}
              <dt>Turn</dt><dd className="break-all">{r.turnId ?? "No runtime turn"}</dd><dt>Tool call</dt><dd className="break-all">{r.toolCallId ?? "No runtime tool call"}</dd>
            </dl>}
            {a && <ProposalDetails approval={a} />}
            {r?.permission != null && <Disclosure title="Permission at dispatch"><EvidenceBlock>{prettyPayload(r.permission)}</EvidenceBlock></Disclosure>}
          </div>
        </Disclosure>
      </>}
      <nav className="flex flex-wrap gap-3" aria-label="Receipt sources">
        <Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind: "room", roomId: a?.roomId ?? r?.originRoomId ?? r!.roomId})} />}>Open conversation</Button>
        {r?.workId && <Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind: "work", workId: r.workId})} />}>Open related Work</Button>}
        <Button variant="ghost" nativeButton={false} render={<a href={hrefFor({kind: "ledger"})} />}>Open full ledger</Button>
      </nav>
    </>}
  </section>;
}
