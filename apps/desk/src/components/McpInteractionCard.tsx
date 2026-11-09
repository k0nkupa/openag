import { EvidenceBlock } from "./EvidenceBlock";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Field, FieldLabel, FieldDescription, FieldSet, FieldLegend } from './ui/field';
import { Input } from './ui/input';
import { SelectField, SelectItem } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import { messageOf } from '../api';
import type { McpInteraction } from '../types';
import { useStream } from "../stream";
import { Button } from './ui/button';
export function McpInteractionCard({ api, id, onChange }: {
    api: Api;
    id: string;
    onChange: () => void;
}) {
    const [request, setRequest] = useState<McpInteraction>(), [error, setError] = useState<string>(), [busy, setBusy] = useState(false), [values, setValues] = useState<Record<string, unknown>>({});
    const { subscribe } = useStream();
    const generation = useRef(0);
    useEffect(() => {
        let active = true;
        setRequest(undefined); setValues({}); setError(undefined);
        const load = async () => {
            const version = ++generation.current;
            try {
                const result = await api.getMcpInteraction(id);
                if (active && version === generation.current) {
                    setRequest(result.interaction);
                    setError(undefined);
                    if (result.interaction.status !== "open") setValues({});
                }
            } catch (error) {
                if (active && version === generation.current) {
                    setRequest(undefined); setValues({}); setError(messageOf(error));
                }
            }
        };
        const off = subscribe({ onOpen: () => void load(), onEvent: event => {
            if (event.type === "mcp_interaction_updated" && event.payload && typeof event.payload === "object" && "interactionId" in event.payload && event.payload.interactionId === id) void load();
        } });
        void load();
        return () => { active = false; ++generation.current; off(); };
    }, [api, id, subscribe]);
    useEffect(() => {
        if (!request || request.status !== "open") return;
        const timer = setTimeout(() => {
            ++generation.current;
            setRequest(old => old ? { ...old, status: "expired", url: undefined } : old);
            setValues({});
        }, Math.max(0, request.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [request]);
    async function respond(action: 'accept' | 'decline' | 'cancel') {
        if (!request || busy || request.status !== "open" || request.expiresAt <= Date.now())
            return;
        ++generation.current;
        setBusy(true);
        setError(undefined);
        try {
            const r = await api.respondMcpInteraction(id, request.revision, action, request.request.mode === 'form' && action === 'accept' ? values : undefined);
            setRequest(r.interaction);
            setValues({});
            onChange();
        }
        catch (e) {
            setError(messageOf(e));
        }
        finally {
            setBusy(false);
        }
    }
    if (!request)
        return <p role={error ? 'alert' : undefined}>{error ?? 'Loading server request…'}</p>;
    const properties = (request.request.requestedSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    return <section aria-label="Integration input request" className="flex flex-col gap-4">
  <Badge variant={request.status === 'open' ? 'attention' : 'outline'}>{request.status === 'open' ? 'Response needed' : 'Integration input'}</Badge>
  <h2 className="text-lg font-semibold">{request.serverId} requests your response</h2>
  <p className="text-sm text-muted-foreground">During {request.toolName}. This response does not change OpenAg tool permissions.</p>
  <p className="whitespace-pre-wrap">{request.request.message}</p>
  {request.status !== 'open' ? <div><Badge variant={request.status === "accepted" ? "success" : request.status === "declined" ? "destructive" : request.status === "cancelled" ? "secondary" : "attention"}>Request {request.status}.</Badge>{request.response?.content && <EvidenceBlock className="my-2.5">{JSON.stringify(request.response.content, null, 2)}</EvidenceBlock>}</div> : <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void respond('accept'); }}>
   {request.request.mode === 'url' ? <>
    <p>Destination: <strong>{request.request.host}</strong>. Opening this page sends you to the integration’s site. OpenAg does not collect its credentials.</p>
    {request.url && <a href={request.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={event => { if (busy || request.status !== 'open' || request.expiresAt <= Date.now())
                event.preventDefault();
            else
                void respond('accept'); }} className="underline">Open {request.request.host}</a>}
   </> : <>
    <p className="text-sm text-muted-foreground">Review each field. Do not enter passwords, API keys or payment credentials.</p>
    {Object.entries(properties).map(([name, field]) => {
                    const options = Array.isArray(field.oneOf) ? field.oneOf.map((o: Record<string, unknown>) => ({ value: o.const, title: String(o.title ?? o.const) })) : Array.isArray(field.enum) ? field.enum.map((o, index) => ({ value: o, title: String(Array.isArray(field.enumNames) ? field.enumNames[index] ?? o : o) })) : null;
                    const set = (value: unknown) => setValues(old => { const next = { ...old }; if (value === undefined)
                        delete next[name];
                    else
                        next[name] = value; return next; });
                    const label = String(field.title ?? name), controlId = `interaction-${id}-${name}`;
                    if (field.type === 'array') {
                      const items = field.items as {anyOf?: {const:string;title?:string}[];enum?:string[]} | undefined;
                      const choices = items?.anyOf ?? (items?.enum ?? []).map(value => ({const:value,title:value}));
                      const selected = Array.isArray(values[name]) ? values[name] as string[] : [];
                      return <FieldSet key={name} disabled={busy}><FieldLegend>{label}</FieldLegend>{Boolean(field.description) && <FieldDescription>{String(field.description)}</FieldDescription>}{choices.map((option,index)=><Field orientation="horizontal" key={index}><Checkbox id={`${controlId}-${index}`} checked={selected.includes(option.const)} onCheckedChange={checked=>set(checked?[...selected,option.const]:selected.filter(value=>value!==option.const))} disabled={busy}/><FieldLabel className="min-h-11" htmlFor={`${controlId}-${index}`}>{option.title??option.const}</FieldLabel></Field>)}</FieldSet>;
                    }
                    return <Field key={name}><FieldLabel htmlFor={controlId}>{label}</FieldLabel>
                      {Boolean(field.description) && <FieldDescription>{String(field.description)}</FieldDescription>}
                      {options ? <SelectField id={controlId} aria-label={label} value={values[name] === undefined ? '' : String(options.findIndex(o => o.value === values[name]) + 1)} onValueChange={(value) => set(value === '' ? undefined : options[Number(value) - 1]?.value)} disabled={busy}><SelectItem value="">Choose…</SelectItem>{options.map((o, index) => <SelectItem key={index} value={String(index + 1)}>{o.title}</SelectItem>)}</SelectField>
                      : field.type === 'boolean' ? <SelectField id={controlId} aria-label={label} value={values[name] === undefined ? '' : String(values[name])} onValueChange={(value) => set(value === '' ? undefined : value === 'true')} disabled={busy}><SelectItem value="">Choose…</SelectItem><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectField>
                      : <Input id={controlId} aria-label={label} autoComplete="off" disabled={busy} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === "number" ? "any" : undefined} value={String(values[name] ?? '')} onChange={event => set(event.target.value === '' ? undefined : field.type === 'number' || field.type === 'integer' ? Number(event.target.value) : event.target.value)}/>}
                    </Field>;

                })}
    <Button type="submit" disabled={busy}>Send this response</Button>
   </>}
   <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void respond('decline')}>Decline</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void respond('cancel')}>Cancel</Button></div>
  </form>}
  {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
 </section>;
}
