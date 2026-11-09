import { EvidenceBlock } from "./EvidenceBlock";
import { Field, FieldLabel, FieldDescription, FieldGroup, FieldContent, FieldSet, FieldLegend } from "./ui/field";
import { SelectField, SelectItem } from "./ui/select";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { InputGroup, InputGroupInput, InputGroupAddon } from "./ui/input-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { ArrowLeft, ChevronRight, ChevronDown, RefreshCw, Search, Puzzle, FileText, Info } from "lucide-react";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { useEffect, useId, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { BotInfo, Skill, SkillSummary } from "../types";

export function SkillsPanel({ api, botId: scopedBotId }: { api: Api; botId?: string }) {
  const selectId = useId();
  const requests = useRef(0);
  const detailRequests = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const returnToSearch = useRef(false);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [chosen, setChosen] = useState("");
  const botId = scopedBotId ?? chosen;
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (scopedBotId) return;
    let cancelled = false;
    api.listBots().then(({ bots }) => { if (!cancelled) { setBots(bots); setChosen(bots[0]?.id ?? ""); } }).catch(err => { if (!cancelled) setError(messageOf(err)); });
    return () => { cancelled = true; };
  }, [api, scopedBotId]);

  async function refresh(keepPreview = false) {
    const request = ++requests.current;
    setBusy(true); setError(null);
    if (!keepPreview) { detailRequests.current++; setSkill(null); setSelected(null); }
    try {
      const [who, library] = await Promise.all([api.whoami(), api.getSkillLibrary()]);
      const owner = who.kind === "owner" || who.access === "full";
      const list = await (owner ? api.getSkillCatalogue(botId) : api.listSkills(botId));
      if (request !== requests.current) return;
      setCanManage(owner); setEnabled(library.enabled); setSkills(list.skills); setUncertain(false);
    } catch (err) {
      if (request === requests.current) { setError(`${messageOf(err)} Refresh to check the saved state before trying again.`); setUncertain(true); }
    }
    finally { if (request === requests.current) setBusy(false); }
  }
  useEffect(() => {
    setSkills(null); setUncertain(false); setQuery("");
    if (botId) void refresh();
    return () => { requests.current++; detailRequests.current++; };
  }, [api, botId]);

  async function change(action: () => Promise<unknown>, keepPreview = false) {
    const request = requests.current;
    setBusy(true); setError(null);
    try {
      await action();
      if (request === requests.current) await refresh(keepPreview);
    } catch (err) {
      if (request === requests.current) { setError(`${messageOf(err)} Refresh to check the saved state before trying again.`); setUncertain(true); }
    } finally { if (request === requests.current) setBusy(false); }
  }
  async function select(entry: SkillSummary) {
    const id = entry.id ?? entry.slug, request = ++detailRequests.current;
    setSelected(id); setSkill(null); setError(null);
    try {
      const result = await (canManage ? api.inspectSkill(botId, id) : api.getSkill(botId, id));
      if (request === detailRequests.current) setSkill(result.skill);
    } catch (err) { if (request === detailRequests.current) setError(messageOf(err)); }
  }
  useEffect(() => {
    if (!selected && returnToSearch.current) { searchInput.current?.focus(); returnToSearch.current = false; }
  }, [selected]);
  const assigned = skills?.filter(s => s.source === "shared" && s.assigned).map(s => s.id!) ?? [];
  const selectedEntry = skills?.find(entry => (entry.id ?? entry.slug) === selected);
  const filtered = skills?.filter(entry => `${entry.name} ${entry.description} ${entry.id ?? entry.slug}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const toggleAssignment = (entry: SkillSummary, checked: boolean) => {
    const id = entry.id!;
    return change(() => api.assignSkills(botId, checked ? [...assigned, id] : assigned.filter(value => value !== id)), true);
  };
  const assignmentControl = (entry: SkillSummary) => <Switch
    aria-label={`Assign ${entry.name} (${entry.id ?? entry.slug})`}
    checked={entry.assigned ?? false}
    disabled={!canManage || busy || uncertain || (!entry.assigned && entry.availability !== "available")}
    onCheckedChange={checked => void toggleAssignment(entry, checked)}
  />;
  function back() { returnToSearch.current = true; detailRequests.current++; setSelected(null); setSkill(null); }

  return <div className="flex min-w-0 flex-col gap-5">
    {!scopedBotId && <FieldGroup><Field><FieldLabel htmlFor={selectId}>Agent</FieldLabel><SelectField id={selectId} value={botId} onValueChange={(value) => setChosen(value)}>{bots.map(bot => <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>)}</SelectField></Field></FieldGroup>}
    {botId && <>
      <div className="flex items-center justify-between gap-3">
        {selected ? <Button variant="ghost" size="sm" onClick={back}><ArrowLeft data-icon="inline-start" />All skills</Button> : <p className="text-sm text-muted-foreground">Choose the workflows this agent can use.</p>}
        <Button variant="ghost" size="icon-sm" aria-label="Refresh skills" title="Refresh skills" disabled={busy} onClick={() => void refresh()}><RefreshCw /></Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {selected ? <section aria-label="Skill preview" className="flex min-w-0 flex-col gap-5">
        <FieldGroup><Field orientation="horizontal">
          <FieldContent><h3 className="text-sm font-medium">{selectedEntry?.name ?? "Skill preview"}</h3><FieldDescription className="[overflow-wrap:anywhere]">{selected}</FieldDescription></FieldContent>
          {selectedEntry?.source === "shared" && assignmentControl(selectedEntry)}
        </Field></FieldGroup>
        {skill ? <>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{skill.source === "shared" ? "Shared library" : "Agent-owned"}</Badge>{skill.version != null && <Badge variant="outline">v{skill.version}</Badge>}{selectedEntry?.source === "shared" && <Badge variant={selectedEntry.assigned ? "success" : "attention"} role="status">{selectedEntry.assigned ? "Assigned" : "Not assigned"}</Badge>}</div>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{skill.description}</p>
          <Separator />
          <EvidenceBlock data-testid="skill-body" className="max-h-[50dvh]">{skill.body}</EvidenceBlock>
          <Collapsible className="flex flex-col gap-3"><CollapsibleTrigger render={<Button variant="ghost" size="sm" className="justify-start" />}><Info data-icon="inline-start" />Package details<ChevronDown data-icon="inline-end" /></CollapsibleTrigger>
            <CollapsibleContent className="flex min-w-0 flex-col gap-4">
              {!!skill.triggers.length && <p className="text-sm text-muted-foreground">Triggers: {skill.triggers.join(", ")}</p>}
              <div className="flex flex-col gap-1"><p className="text-sm font-medium">Requirements</p><p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{selectedEntry?.requirements ?? "No requirements declared."}</p><p className="text-sm text-muted-foreground">Requirements have not been verified.</p></div>
              {!!skill.resources?.length && <div className="flex flex-col gap-2"><p className="text-sm font-medium">Resources</p><ul className="flex flex-col gap-2">{skill.resources.map(path => <li key={path} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground"><FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="[overflow-wrap:anywhere]">{path}</span></li>)}</ul></div>}
            </CollapsibleContent>
          </Collapsible>
        </> : !error && <div aria-label="Loading skill" className="flex flex-col gap-3"><Skeleton className="h-4 w-2/3 motion-reduce:animate-none" /><Skeleton className="h-48 w-full motion-reduce:animate-none" /></div>}
      </section> : <>
        <FieldGroup><Field orientation="horizontal" data-disabled={!canManage || busy || uncertain}>
          <FieldContent><FieldLabel htmlFor={`${selectId}-library`}>Shared library</FieldLabel><FieldDescription>From this server’s <code>~/.agents/skills</code>. Assign skills to this agent below.</FieldDescription></FieldContent>
          <Switch id={`${selectId}-library`} aria-label="Shared library" checked={enabled} disabled={!canManage || busy || uncertain} onCheckedChange={checked => void change(() => api.setSkillLibrary(checked))} />
        </Field></FieldGroup>
        <Separator />
        <FieldGroup><Field><FieldLabel htmlFor={`${selectId}-search`} className="sr-only">Search skills</FieldLabel><InputGroup><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput ref={searchInput} id={`${selectId}-search`} placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)} /></InputGroup></Field></FieldGroup>
        {skills === null ? <div aria-label="Loading skills" className="flex flex-col gap-4">{[0,1,2].map(index => <Skeleton key={index} className="h-16 w-full motion-reduce:animate-none" />)}</div> : filtered.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Puzzle /></EmptyMedia><EmptyTitle>{query ? "No matching skills" : "No skills yet"}</EmptyTitle><EmptyDescription>{query ? "Try a name, description or source." : enabled ? "Add a skill to the shared library to find it here." : "Enable the shared library to browse available workflows."}</EmptyDescription></EmptyHeader></Empty> : <FieldSet className="gap-2">
          <FieldLegend variant="label" className="flex items-center justify-between gap-3"><span>Skills</span><Badge variant="secondary">{assigned.length} assigned</Badge></FieldLegend>
          <ul className="flex min-w-0 flex-col">{filtered.map((entry, index) => {
            const id = entry.id ?? entry.slug;
            return <li key={id}>
              {index > 0 && <Separator />}
              <div className="flex min-w-0 items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Button variant="ghost" className="h-auto max-w-full justify-start self-start whitespace-normal px-0 py-1 text-left [overflow-wrap:anywhere]" aria-label={`Preview ${entry.name} (${id})`} disabled={busy || entry.availability === "invalid" || entry.availability === "missing"} onClick={() => void select(entry)}>{entry.name}<ChevronRight data-icon="inline-end" /></Button>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{id}{entry.version != null && ` · v${entry.version}`}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{entry.reason ?? entry.description}</p>
                </div>
                {entry.source === "shared" ? assignmentControl(entry) : <Badge variant="outline">Agent-owned</Badge>}
              </div>
            </li>;
          })}</ul>
        </FieldSet>}
        <Collapsible className="flex flex-col gap-3"><CollapsibleTrigger render={<Button variant="ghost" size="sm" className="justify-start" />}><Info data-icon="inline-start" />About skills<ChevronDown data-icon="inline-end" /></CollapsibleTrigger><CollapsibleContent><p className="text-sm leading-relaxed text-muted-foreground">Shared packages start unassigned. OpenAg skill tools keep shared files read-only; other file and shell tools keep their own permissions. Loading a skill never approves its actions or runs its scripts. {canManage ? "Library changes affect all agents; assignments apply to this agent." : "A Full access device can change the library and assignments."}</p></CollapsibleContent></Collapsible>
      </>}
    </>}
  </div>;
}
