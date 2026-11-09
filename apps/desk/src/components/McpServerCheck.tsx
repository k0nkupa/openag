import { useEffect, useRef, useState } from "react";
import { Plug } from "lucide-react";
import { messageOf, type Api } from "../api";
import { mcpHint } from "../mcp-hints";
import type { Approval, Decision, McpCheckState, McpServerInput } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "review"; approval: Approval; expiresInMs: number }
  | { kind: "waiting" }
  | { kind: "result"; state: McpCheckState };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A server check is a tool action: proposing it creates an approval, and the daemon contacts the server only after you accept it
 * here. Results are untrusted text and are shown as plain text. Editing the candidate drops the proposal and any result, so a result
 * never describes an address that is no longer in the form.
 */
export function McpServerCheck({ api, candidate }: { api: Api; candidate: (McpServerInput & { id?: string }) | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const gone = useRef(false);
  const generation = useRef(0);
  const key = JSON.stringify(candidate);
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  useEffect(() => { generation.current++; setPhase({ kind: "idle" }); setError(null); }, [key]);
  // An unanswered proposal expires on the daemon; show that here instead of leaving a card that can no longer be accepted.
  useEffect(() => {
    if (phase.kind !== "review") return;
    const timer = setTimeout(() => setPhase({ kind: "result", state: { state: "expired" } }), phase.expiresInMs);
    return () => clearTimeout(timer);
  }, [phase]);

  async function propose() {
    if (!candidate) return;
    const mine = ++generation.current;
    setError(null); setPhase({ kind: "asking" });
    try {
      const { approvalId, expiresInMs } = await api.checkMcpServer(candidate);
      const { approval } = await api.getApproval(approvalId); if (!approval) throw new Error("The approval is no longer available. Try again.");
      if (!gone.current && mine === generation.current) setPhase({ kind: "review", approval, expiresInMs });
    } catch (err) {
      if (!gone.current && mine === generation.current) { setError(messageOf(err)); setPhase({ kind: "idle" }); }
    }
  }

  async function decide(id: string, decision: Decision) {
    const mine = generation.current;
    await api.decide(id, decision);
    if (gone.current || mine !== generation.current) return;
    setPhase({ kind: "waiting" });
    for (let attempt = 0; attempt < 80 && !gone.current && mine === generation.current; attempt++) {
      try {
        const state = await api.getMcpCheck(id);
        if (mine !== generation.current) return;
        if (state.state === "done" || state.state === "declined" || state.state === "expired") { setPhase({ kind: "result", state }); return; }
      } catch (err) { if (mine === generation.current) { setError(messageOf(err)); setPhase({ kind: "idle" }); } return; }
      await sleep(400);
    }
    if (!gone.current && mine === generation.current) { setError("The check is taking longer than expected. Try again."); setPhase({ kind: "idle" }); }
  }

  return <section className="flex min-w-0 flex-col gap-3" aria-label="Server check">
    {error && <Alert variant="destructive"><AlertTitle>Check unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {(phase.kind === "idle" || phase.kind === "asking" || phase.kind === "result") && <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={!candidate || phase.kind === "asking"} onClick={() => void propose()}><Plug data-icon="inline-start" />{phase.kind === "asking" ? "Preparing check…" : phase.kind === "result" ? "Check again" : "Check server"}</Button>
      {!candidate && <span className="library-meta">Enter the address to check it.</span>}
    </div>}
    {phase.kind === "review" && <ApprovalCard approval={phase.approval} onDecide={decide} />}
    {phase.kind === "waiting" && <p className="library-meta" role="status">Checking the server…</p>}
    {phase.kind === "result" && <CheckResult state={phase.state} />}
  </section>;
}

function CheckResult({ state }: { state: McpCheckState }) {
  if (state.state === "declined") return <Alert><AlertTitle>Not checked</AlertTitle><AlertDescription>The check was cancelled, so nothing was contacted.</AlertDescription></Alert>;
  if (state.state === "expired") return <Alert><AlertTitle>Check expired</AlertTitle><AlertDescription>The check was not approved in time. Request it again.</AlertDescription></Alert>;
  if (state.state !== "done") return null;
  if (!state.ok) {
    const hint = mcpHint(state.reason);
    return <Alert variant="destructive"><AlertTitle>The check did not complete</AlertTitle><AlertDescription><p>{state.reason}</p>{hint && <p>{hint}</p>}</AlertDescription></Alert>;
  }
  return <Alert><AlertTitle>Server reachable: {state.tools.length}{state.truncated ? "+" : ""} {state.tools.length === 1 ? "tool" : "tools"}</AlertTitle><AlertDescription>
    {state.tools.length === 0 ? <p>The server listed no tools.</p> : <ul className="flex flex-col gap-1">{state.tools.map(tool => <li key={tool.name} className="min-w-0 break-words"><code className="break-all">{tool.name}</code>{tool.description ? <span className="text-muted-foreground"> — {tool.description}</span> : null}</li>)}</ul>}
  </AlertDescription></Alert>;
}
