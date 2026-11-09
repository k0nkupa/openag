import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { Approval, BotInfo, BotMemory, Decision, MemoryHit } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { SettingsSection } from "./SettingsLayout";
import { SkillsPanel } from "./SkillsPanel";

import { useStream } from "../stream";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { SelectField, SelectItem } from "./ui/select";

const OWNER_REQUIRED = "owner token required";

export function MemoryPage({ api, bot: scopedBot }: { api: Api; bot?: BotInfo }) {
  const { subscribe, status } = useStream();
  const pending = useRef(false);
  const searchVersion = useRef(0);
  const proposalVersion = useRef(0);
  const [bots, setBots] = useState<BotInfo[]>(scopedBot ? [scopedBot] : []);
  const [chosenBotId, setBotId] = useState<string | null>(null);
  const botId = scopedBot?.id ?? chosenBotId;
  const [memory, setMemory] = useState<BotMemory | null>(null);
  const [draft, setDraft] = useState("");
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<Approval[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (scopedBot) return;
    api.listBots().then(
      (r) => {
        setBots(r.bots);
        setBotId((cur) => cur ?? r.bots[0]?.id ?? null);
      },
      (err: unknown) => setError(messageOf(err)),
    );
  }, [api, scopedBot?.id]);

  const loadProposals = useCallback(() => {
    const version = ++proposalVersion.current;
    api.listPending().then(
      (r) => { if (version === proposalVersion.current) setProposals(r.approvals.filter((a) => a.toolName === "reflection_memory" || a.toolName === "reflection_skill")); },
      () => undefined,
    );
  }, [api]);
  useEffect(() => { loadProposals(); return () => { proposalVersion.current++; }; }, [loadProposals, status]);
  useEffect(() => subscribe({ onEvent: event => { if (event.type === "approval_decided" || event.type === "approval_requested") loadProposals(); } }), [subscribe, loadProposals]);

  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    searchVersion.current++;
    setHits(null);
    setSearchError(null);
    setLocked(false);
    setMemory(null);
    setSaved(false);
    setError(null);
    api.getBotMemory(botId).then(
      (m) => {
        if (cancelled) return;
        setMemory(m);
        setDraft(m.text);
      },
      (err: unknown) => !cancelled && setError(messageOf(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [api, botId]);

  async function save() {
    if (!botId || pending.current || !memory) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api.putBotMemory(botId, draft);
      setDraft(r.text);
      setMemory((m) => (m ? { ...m, text: r.text, headTokens: Math.ceil(r.text.length / 4) } : m));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes(OWNER_REQUIRED)) setLocked(true);
      else setError(messageOf(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function decide(id: string, d: Decision) {
    try {
      await api.decide(id, d);
    } finally {
      loadProposals();
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!botId || q.trim().length < 2) return;
    const version = ++searchVersion.current;
    setSearchError(null);
    try {
      const response = await api.searchMemory(botId, q.trim());
      if (version === searchVersion.current) setHits(response.results);
    } catch (err) {
      if (version !== searchVersion.current) return;
      setHits(null);
      setSearchError(err instanceof ApiError && err.status === 503 ? "Search needs embeddings (Ollama running with an embedding model)." : messageOf(err));
    }
  }

  const dirty = memory !== null && draft !== memory.text;
  useUnsavedChanges(dirty, busy);
  const bot = scopedBot ?? bots.find((b) => b.id === botId);

  return (
    <section className={scopedBot ? undefined : "flex flex-col gap-8"} aria-label={scopedBot ? `${scopedBot.name} memories` : "Memory & Skills"}>
      {!scopedBot && <h1 id="memory-title">Memory &amp; Skills</h1>}
      {!scopedBot && <Field className="max-w-sm"><FieldLabel htmlFor="memory-bot">Bot</FieldLabel><SelectField id="memory-bot" className="w-full" value={botId ?? ""} disabled={busy || dirty} onValueChange={(value) => setBotId(value)}>{bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectField>{dirty && <p className="mt-1.5 text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">Save or discard your draft before changing bots.</p>}</Field>}

      <SettingsSection icon="memory" title="Saved memory" description={`Standing notes for ${bot?.name ?? "this bot"}. Remove unwanted notes here and save.`}>
        {error && <Alert variant="destructive" className="mt-1.5 text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {locked && <p className="mt-0 mb-2 text-[var(--warn)] [overflow-wrap:anywhere]" role="status">Editing memory is owner-only. Ask a trusted Full access device to change this device in Settings, Devices, or run pnpm desk:open on the daemon host.</p>}
        <label className="sr-only" htmlFor="memory-text">MEMORY.md</label>
        <Textarea id="memory-text" disabled={busy || !memory} className="min-h-60 resize-y font-mono text-[13px] leading-5" rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs leading-[18px] text-muted-foreground">
            Prompt head: {memory ? Math.ceil(draft.length / 4) : "…"} of {memory?.headCap ?? 1500} tokens
          </span>
          <span className="grow" />
          {saved && !dirty && <span className="font-mono text-xs leading-[18px] text-muted-foreground" role="status">Saved</span>}
          <Button type="button" disabled={!dirty || busy} onClick={() => void save()}>Save</Button>
          <Button variant="outline" disabled={!dirty || busy} onClick={() => { setDraft(memory?.text ?? ""); setError(null); setLocked(false); }}>Discard</Button>
        </div>
        <p className="mt-1.5 text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">Memory is included in this bot’s prompt. Secrets are removed on save. Save repeatable workflows in Skills.</p>
      </SettingsSection>

      {!scopedBot && <>
      <SettingsSection icon="bolt" title="Skills" description="Repeatable workflows. Bots propose new ones; you approve each in the Inbox.">
        <SkillsPanel api={api} botId={botId ?? undefined} />
        {proposals.length > 0 && (
          <>
            <h3>Proposed by nightly reflection</h3>
            <ul data-slot="approval-cards" className="m-0 grid list-none gap-3 p-0">
              {proposals.filter(a => a.botId === botId).map((a) => (
                <li key={a.id}>
                  <ApprovalCard approval={a} onDecide={decide} />
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsSection>

      </>}

      {scopedBot && proposals.filter(a => a.botId === botId).map(a => <ApprovalCard key={a.id} approval={a} onDecide={decide} />)}

      <SettingsSection icon="memory" title="Search memory" description="Past threads and MEMORY.md for the selected bot.">
        <form className="my-2 flex flex-wrap items-end gap-2" onSubmit={(e) => void search(e)}>
          <div className="grid min-w-0 flex-[1_1_220px] gap-1">
            <label htmlFor="mem-q">Search memory</label>
            <Input id="mem-q" type="text" value={q} onChange={(e) => { searchVersion.current++; setQ(e.target.value); setHits(null); }} />
          </div>
          <Button type="submit" disabled={q.trim().length < 2}>Search</Button>
        </form>
        {searchError && <Alert variant="destructive" className="mt-1.5 text-destructive"><AlertDescription>{searchError}</AlertDescription></Alert>}
        {hits && hits.length === 0 && <p className="text-muted-foreground">No matches.</p>}
        {hits && hits.length > 0 && (
          <Card><CardContent><ul className="m-0 list-none p-0">
            {hits.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3.5 border-b border-border p-5 last:border-b-0 max-md:p-4">
                <div className="flex min-w-0 flex-[1_1_220px] flex-col">
                  <span>{h.text}</span>
                  <span className="font-mono text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">{h.source}</span>
                </div>
              </li>
            ))}
          </ul></CardContent></Card>
        )}
      </SettingsSection>
    </section>
  );
}
