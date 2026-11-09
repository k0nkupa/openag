import { Disclosure } from "./Disclosure";
import { useBotModelSettings } from "../bot-model-settings";
import { modelChoiceKey } from "../model-catalogue";
import { useState } from "react";
import { BrainCircuit } from "lucide-react";
import { type Api } from "../api";
import type { BotInfo, ModelReport } from "../types";
import { BotSettingRow } from "./BotSettingRow";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { ReasoningFields } from "./ReasoningFields";
import { ModelSelector } from "./ui/model-selector";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";

const HINT = "mt-1.5 mb-0 text-[13px] text-muted-foreground [overflow-wrap:anywhere]";
export function ModelReports({ reports }: { reports: ModelReport[] }) {
  return reports.length ? <div className="flex flex-col gap-4">{reports.map((report, index) => <section key={index} aria-label={`${report.source === "session" ? "Session" : "Returned"} model report for ${report.roomId}`} className="flex min-w-0 flex-col gap-3 border-t border-border pt-3">
    <div className="flex flex-wrap items-center gap-2"><h4>{report.source === "session" ? "Session report" : "Returned report"}</h4><Badge variant={report.freshness === "previous-configuration" ? "attention" : "outline"}>{report.freshness === "previous-configuration" ? "Previous configuration, stale" : "Last reported"}</Badge></div>
    <dl className="grid gap-2 text-sm [overflow-wrap:anywhere]">
      <div><dt className="text-muted-foreground">Room</dt><dd>{report.roomId}</dd></div>
      <div><dt className="text-muted-foreground">{report.source === "session" ? "Session model" : "Returned model"}</dt><dd>{report.modelName ? report.model ? `${report.modelName} (${report.model})` : report.modelName : report.model ?? "Not reported"}</dd></div>
      <div><dt className="text-muted-foreground">{report.source === "session" ? "Session effort" : "Reported effort"}</dt><dd>{report.effort ?? "Not reported"}</dd></div>
      <div><dt className="text-muted-foreground">Reported at</dt><dd><time dateTime={new Date(report.at).toISOString()}>{new Date(report.at).toLocaleString()}</time></dd></div>
      {report.provider && <div><dt className="text-muted-foreground">Provider</dt><dd>{report.provider}</dd></div>}
      {report.turnId && <div><dt className="text-muted-foreground">Turn</dt><dd>{report.turnId}</dd></div>}
      {report.sessionId && <div><dt className="text-muted-foreground">Session</dt><dd>{report.sessionId}</dd></div>}
      {report.revision && <div><dt className="text-muted-foreground">Configuration revision</dt><dd>{report.revision}</dd></div>}
    </dl>
    {!!report.warnings?.length && <ul className="list-disc pl-5 text-sm text-muted-foreground">{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
  </section>)}</div> : <p className={HINT}>No model reports yet.</p>;
}
export function BotModelSettings({ api, bot, onSaved }: { api: Api; bot: BotInfo; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const {state, target, model, reasoning, setReasoning, choices, error, status, busy, catalogue, choose, save, beginDiscovery} = useBotModelSettings(api, bot, open, onSaved);
  const selected = modelChoiceKey(target, model);
  const models = model && !catalogue.models.some(m => m.id === selected) ? [{ id: selected, name: model, provider: target }, ...catalogue.models] : catalogue.models;
  return <BotSettingRow title="Model and reasoning" icon={BrainCircuit} onOpenChange={next => { setOpen(next); if (next) { beginDiscovery(); } }}>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {status && <p role="status">{status}</p>}
    {state?.override && <Alert><AlertDescription>An administrator controls this model. Ask the server administrator to change it.</AlertDescription></Alert>}
    <FieldGroup>
      <Field><FieldLabel htmlFor={`model-choice-${bot.id}`}>Model</FieldLabel>
        <ModelSelector id={`model-choice-${bot.id}`} loading={catalogue.loading || busy} disabled={busy || !!state?.override || !catalogue.models.length} models={models} value={model ? selected : undefined} onValueChange={key => void choose(key)} />
      </Field>
      <ReasoningFields id={`model-${bot.id}`} controls={choices?.controls ?? []} value={reasoning} onChange={setReasoning} disabled={busy || !choices} />
      {!!catalogue.errors.length && <Disclosure className={HINT} title={<> Unavailable model sources </>}> {catalogue.errors.map(e => <p key={e}>{e}</p>)}<Button variant="outline" disabled={busy} onClick={catalogue.reload}>Try again</Button></Disclosure>}
      {state && !catalogue.loading && !catalogue.models.length && !catalogue.errors.length && !state.override && <p className={HINT}>No models are available. Use Refresh models in Settings → Models.</p>}
      <Button disabled={!choices || catalogue.loading || busy || !!state?.override} onClick={() => void save()}>Save model configuration</Button>
    </FieldGroup>
    <Disclosure title="Model diagnostics">
      {choices?.reason && <p className={HINT}>{choices.reason}</p>}
      <dl className="grid gap-3 text-sm [overflow-wrap:anywhere]">
        <div><dt className="text-muted-foreground">Saved model</dt><dd>{state?.model ?? "Default"}</dd></div>
        <div><dt className="text-muted-foreground">Configured reasoning</dt><dd>{state && Object.keys(state.reasoning).length ? Object.entries(state.reasoning).map(([key, value]) => `${key}: ${value}`).join(", ") : "Default"}</dd></div>
        <div><dt className="text-muted-foreground">Requested model</dt><dd>{state?.effectiveModel ?? "Not reported"}</dd></div>
        {state?.target && <div><dt className="text-muted-foreground">Selected provider</dt><dd>{state.target}</dd></div>}
        {state?.revision && <div><dt className="text-muted-foreground">Configuration revision</dt><dd>{state.revision}</dd></div>}
      </dl>
      <ModelReports reports={state?.reports ?? []} />
      {state?.reportsTruncated && <p className={HINT}>Showing the most recent 100 room/source reports. Older evidence remains in the full ledger.</p>}
    </Disclosure>
  </BotSettingRow>;
}
