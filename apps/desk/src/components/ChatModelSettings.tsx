import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Api } from "../api";
import type { BotInfo } from "../types";
import { modelChoiceKey } from "../model-catalogue";
import { useBotModelSettings } from "../bot-model-settings";
import { ReasoningFields } from "./ReasoningFields";
import { ModelSelector } from "./ui/model-selector";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

export interface ChatModelSettingsHandle { isBlocked(): boolean }
export const ChatModelSettings = forwardRef<ChatModelSettingsHandle, {api: Api; bot: BotInfo; canManage: boolean; disabled: boolean; onBlockedChange: (blocked: boolean) => void; onAttentionChange: (attention: boolean) => void; onSettled: () => void}>(function ChatModelSettings({api, bot, canManage, disabled, onBlockedChange, onAttentionChange, onSettled}, ref) {
  const [active, setActive] = useState(false);
  const onSaved = useCallback(() => {}, []);
  const config = useBotModelSettings(api, bot, active && canManage, onSaved, true);
  const {state, target, model, choices, reasoning, catalogue, busy, dirty, error} = config;
  const blocked = busy || catalogue.loading || dirty;
  const attention = canManage && (!!error || catalogue.errors.length > 0);
  useEffect(() => { onAttentionChange(attention); return () => onAttentionChange(false); }, [attention, onAttentionChange]);
  const previousBusy = useRef(busy), reloadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (previousBusy.current && !busy && document.activeElement === document.body) {
      if (dirty) reloadButton.current?.focus(); else onSettled();
    }
    previousBusy.current = busy;
  }, [busy, dirty, onSettled]);
  useImperativeHandle(ref, () => ({isBlocked: config.isBlocked}));
  useEffect(() => { onBlockedChange(blocked); return () => onBlockedChange(false); }, [blocked, onBlockedChange]);
  const selected = modelChoiceKey(target, model);
  const models = model && !catalogue.models.some(item => item.id === selected) ? [{id: selected, name: model, provider: target}, ...catalogue.models] : catalogue.models;
  const multipleControls = (choices?.controls.filter(control => control.values).length ?? 0) > 1;
  const locked = disabled || busy || !state || !canManage || !!state.override;
  const activate = (open: boolean) => { if (open) setActive(true); };
  return <div className={cn("ml-auto flex min-w-0 flex-1 flex-col items-end gap-2", multipleControls && "max-md:order-3 max-md:basis-full")} aria-label={`Model settings for ${bot.name}`}>
    <div className={cn("flex min-w-0 max-w-full items-center justify-end gap-2", multipleControls && "flex-wrap")}><ModelSelector compact models={models} value={model ? selected : undefined} placeholder={state?.effectiveModel ?? "Default model"} loading={catalogue.loading || busy} disabled={locked} onOpenChange={activate} onValueChange={key => void config.choose(key, true)} />
    <ReasoningFields optionsDisabled={!choices || catalogue.loading} compact onOpenChange={activate} id={`chat-${bot.id}`} controls={choices?.controls.filter(control => control.values) ?? [{id: "pending", name: "Effort", values: Object.keys(reasoning).length ? [{value: String(Object.values(reasoning)[0]), name: String(Object.values(reasoning)[0])}] : []}]} value={choices ? reasoning : Object.keys(reasoning).length ? {pending: String(Object.values(reasoning)[0])} : {}} onChange={next => { if (choices) void config.save(next); }} disabled={locked} /></div>
    {canManage && error && <Alert variant="destructive" className="basis-full"><AlertDescription>{error}<Button ref={reloadButton} size="sm" variant="outline" disabled={busy} onClick={() => void config.reload()}>Reload model settings</Button></AlertDescription></Alert>}
    {canManage && !!catalogue.errors.length && !error && <p role="status" className="m-0 basis-full text-xs text-muted-foreground">Some model sources are unavailable. <Button size="sm" variant="ghost" disabled={busy} onClick={() => void config.reload()}>Refresh models</Button></p>}
    {dirty && !busy && <Button size="sm" variant="outline" disabled={catalogue.loading} onClick={() => void config.save()}>Apply model changes</Button>}
    {busy && <span role="status" className="sr-only">Saving model settings…</span>}
    {!canManage && <span className="sr-only">Full access is required to change this agent’s model.</span>}
    {state?.override && <span className="sr-only">The server administrator controls this model.</span>}
  </div>;
});
