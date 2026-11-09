import { MessageQuote } from "./MessageQuote";
import { useDictation } from "../hooks/useDictation";
import { PermissionControl,type PermissionControlHandle } from './PermissionControl';
import type {StreamListener} from '../stream';
import { Popover, PopoverContent } from "./ui/popover";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ApiError, messageOf, type Api } from "../api";
import type { Attachment, BotInfo, LedgerEvent, MessageReply } from "../types";
import { ChatModelSettings, type ChatModelSettingsHandle } from "./ChatModelSettings";
import { BotAvatar } from "./BotAvatar";
import { ArrowUp, Plus, X, RotateCw, File, Mic, Square } from "lucide-react";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group";
import { Attachment as AttachmentSurface, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions, AttachmentAction } from "./ui/attachment";
import { Alert, AlertDescription } from "./ui/alert";

// `@name` only addresses a bot at the start of the text or after whitespace (same rule as the daemon).
const MENTION_AT_CARET = /(?<![^\s])@([A-Za-z0-9_-]*)$/;

interface Option {
  id: string;
  name: string;
  description: string;
}

export interface ComposerHandle { isSending():boolean; hasDraft():boolean; focus():void; addFiles(files: File[], pointerAdded?: boolean): void; replyTo(message:LedgerEvent):void }
interface Upload { pointerAdded?: boolean; key: string; file: File; preview?: string; attachment?: Attachment; error?: string; removing?: boolean }
export const Composer = forwardRef<ComposerHandle, { api: Api; roomId: string; onSend: (text: string, attachments: string[], replyToMessageId?:number) => Promise<void>; replyTo?:{botId:string;prompt:string;onCancel:()=>void}; bots?: readonly BotInfo[]; direct?:boolean; defaultBotId?: string; permissionBotId?:string; subscribe?:(listener:StreamListener)=>()=>void; routed?: boolean; canManage?: boolean; disabled?: boolean; showSuggestions?: boolean; onAttachmentAvailabilityChange?: (available: boolean) => void }>(function Composer({ api, roomId, onSend, replyTo, bots = [], direct = false, permissionBotId, subscribe, defaultBotId, routed = false, canManage = false, disabled = false, showSuggestions = false, onAttachmentAvailabilityChange }, ref) {
  const permissionPicker=useRef<PermissionControlHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [reply, setReply] = useState<MessageReply>();
  const [focused, setFocused] = useState(false);
  const pointerMotion = useRef(false);
  const heightMotion = useRef<Animation | null>(null);
  const measured = useRef<{ expanded: boolean; height: number } | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadsRef = useRef<Upload[]>([]);
  const removing = useRef(new Set<string>());
  const activeUploads = useRef(new Set<string>());
  const picker = useRef<HTMLInputElement>(null);
  const pointerPicker = useRef(false);
  function changeUploads(next: Upload[]) { uploadsRef.current = next; setUploads(next); }
  useEffect(() => () => { for (const row of uploadsRef.current) { if (row.preview) URL.revokeObjectURL(row.preview); if (row.attachment && !sendingRef.current) void api.removeAttachment(roomId, row.attachment.id).catch(() => undefined); } uploadsRef.current = []; }, []);
  async function upload(row: Upload) {
    if (activeUploads.current.has(row.key)) return;
    activeUploads.current.add(row.key);
    try {
      const { attachment } = await api.uploadAttachment(roomId, row.file);
      if (!uploadsRef.current.some(item => item.key === row.key)) { await api.removeAttachment(roomId, attachment.id); return; }
      changeUploads(uploadsRef.current.map(item => item.key === row.key ? { ...item, attachment, error: undefined } : item));
    } catch (err) { changeUploads(uploadsRef.current.map(item => item.key === row.key ? { ...item, error: messageOf(err) } : item)); }
    finally { activeUploads.current.delete(row.key); }
  }
  function addFiles(files: File[], pointerAdded = false) {
    if (disabled || sendingRef.current) return;
    if (uploadsRef.current.length + files.length > 6 || uploadsRef.current.reduce((sum, row) => sum + row.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) { setError("Use up to six files, totalling at most 10 MiB."); return; }
    const rows = files.map(file => ({ key: crypto.randomUUID(), file, pointerAdded, ...(file.type.startsWith("image/") ? { preview: URL.createObjectURL(file) } : {}) }));
    changeUploads([...uploadsRef.current, ...rows]);
    for (const row of rows) void upload(row);
  }
  useImperativeHandle(ref, () => ({ addFiles, isSending:()=>sendingRef.current, hasDraft:()=>Boolean(areaRef.current?.value||uploadsRef.current.length||reply), focus:()=>{if(sendingRef.current)return;setReply(undefined);areaRef.current?.focus();}, replyTo(message) {
    if (disabled || sendingRef.current || message.roomId !== roomId) return;
    replyTo?.onCancel();
    const payload = message.payload as { text?: string };
    setReply({ messageId: message.id, actor: message.actor, text: payload.text?.trim() ? payload.text.slice(0, 1200) : '[Attachments]' });
    areaRef.current?.focus();
  } }));
  async function remove(row: Upload) {
    if (sendingRef.current || removing.current.has(row.key)) return;
    removing.current.add(row.key);
    changeUploads(uploadsRef.current.map(item => item.key === row.key ? { ...item, removing: true } : item));
    try {
      if (row.attachment) {
        try { await api.removeAttachment(roomId, row.attachment.id); }
        catch (err) { if (!(err instanceof ApiError && err.status === 404)) throw err; }
      }
      if (row.preview) URL.revokeObjectURL(row.preview);
      changeUploads(uploadsRef.current.filter(item => item.key !== row.key));
    } catch (err) {
      setError(messageOf(err));
      changeUploads(uploadsRef.current.map(item => item.key === row.key ? { ...item, removing: false } : item));
    } finally { removing.current.delete(row.key); }
  }
  const [text, setText] = useState("");
  const [modelBlocked, setModelBlocked] = useState(false);
  const [modelAttention, setModelAttention] = useState(false);
  const modelSettings = useRef<ChatModelSettingsHandle>(null);
  const conversationBot=direct?bots.find(bot=>bot.id===defaultBotId):bots.length===1?bots[0]:undefined;
  const modelBot = replyTo?bots.find(bot=>bot.id===replyTo.botId):composerModelBot(text, bots, defaultBotId, routed);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  useEffect(() => {
    onAttachmentAvailabilityChange?.(!disabled && !sending);
  return () => onAttachmentAvailabilityChange?.(false);
  }, [disabled, sending, onAttachmentAvailabilityChange]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const focusMessage = useCallback(() => areaRef.current?.focus(), []);
  const dictation = useDictation(api, roomId, disabled, transcript => {
    setText(previous => `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${transcript}`);
    requestAnimationFrame(() => { const area = areaRef.current; if (area) { area.focus(); area.setSelectionRange(area.value.length, area.value.length); setCaret(area.value.length); } });
  });
  const dictationLabel = dictation.phase === "starting" ? "Starting microphone…"
    : dictation.phase === "recording" ? "Recording…"
      : dictation.phase === "transcribing" ? "Transcribing…"
        : null;
  const showDictationPrompt = dictation.phase !== "idle" && text.length === 0;
  const expanded = !!reply || focused || text.length > 0 || uploads.length > 0 || dictation.phase !== "idle" || !!dictation.error || !!error || modelBlocked || modelAttention || sending;
  useLayoutEffect(() => {
    const element = formRef.current;
    if (!element) return;
    const previous = measured.current;
    const running = heightMotion.current?.playState === "running";
    if (previous && previous.expanded !== expanded) {
      const before = running ? element.getBoundingClientRect().height : previous.height;
      heightMotion.current?.cancel();
      const after = element.getBoundingClientRect().height;
      if (pointerMotion.current && before !== after && !matchMedia("(prefers-reduced-motion: reduce)").matches && element.animate) {
        // This disclosure needs measured height so text and icons keep their shape.
        heightMotion.current = element.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      }
      measured.current = { expanded, height: after };
    } else if (!running) measured.current = { expanded, height: element.getBoundingClientRect().height };
  }, [expanded]);
  useEffect(() => {
    const element = formRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      if (heightMotion.current?.playState === "running") return;
      const entry = entries.find(entry => entry.target === element);
      if (entry && measured.current) measured.current.height = entry.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => heightMotion.current?.cancel();
    const keyboard = () => { pointerMotion.current = false; stop(); };
    const pointer = () => { pointerMotion.current = true; };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("resize", stop);
    reduce.addEventListener("change", stop);
    return () => { stop(); window.removeEventListener("keydown", keyboard, true); window.removeEventListener("pointerdown", pointer, true); window.removeEventListener("resize", stop); reduce.removeEventListener("change", stop); };
  }, []);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // The mention being typed right before the caret, and the bots that match it.
  const mention = useMemo(() => {
    const m = MENTION_AT_CARET.exec(text.slice(0, caret));
    return m ? { query: m[1].toLowerCase(), start: caret - m[0].length } : null;
  }, [text, caret]);
  const options = useMemo<Option[]>(() => {
    if (!mention) return [];
    const all: Option[] = [
      ...bots.map((b) => ({ id: b.id, name: b.name, description: `@${b.id} · ${b.description ?? `${b.runtime}${b.adapter ? ` · ${b.adapter}` : ""}`}` })),
      ...(!direct && bots.length > 1 ? [{ id: "everyone", name: "everyone", description: "Every bot in this room" }] : []),
    ];
    return all.filter((o) => o.id.toLowerCase().startsWith(mention.query) || o.name.toLowerCase().startsWith(mention.query));
  }, [mention, bots, direct]);
  const open = !sending && !modelBlocked && mention !== null && options.length > 0 && dismissed !== `${mention.start}:${mention.query}`;
  const current = Math.min(active, Math.max(options.length - 1, 0));

  function pick(o: Option) {
    if (!mention || sendingRef.current || modelSettings.current?.isBlocked()) return;
    const next = `${text.slice(0, mention.start)}@${o.id} ${text.slice(caret)}`;
    const pos = mention.start + o.id.length + 2;
    setText(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function send() {
    const body = text.trim();
    if (dictation.isBusy()) return;
    if(body==='/permission'){permissionPicker.current?.open();setText('');return;}
    if ((!body && !uploads.length) || disabled || modelSettings.current?.isBlocked() || sendingRef.current || removing.current.size > 0 || uploads.some(row => !row.attachment)) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(body, uploads.map(row => row.attachment!.id), reply?.messageId);
      setReply(undefined);
      setText("");
      for (const row of uploadsRef.current) if (row.preview) URL.revokeObjectURL(row.preview);
      changeUploads([]);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0
        ? "Delivery is unconfirmed. Check the conversation before sending again. Your draft is kept here."
        : messageOf(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && mention) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((current + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        pick(options[current]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(`${mention.start}:${mention.query}`);
        return;
      }
    }
    if (e.key === "Escape" && reply && !sendingRef.current) { e.preventDefault(); setReply(undefined); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <form
      ref={formRef}
      data-composer-expanded={expanded}
      onFocusCapture={event => {
        if (pointerMotion.current && (event.target as Element).closest("button")) return;
        setFocused(true);
      }}
      onBlurCapture={event => {
        const next = event.relatedTarget;
        if (next instanceof Element && (event.currentTarget.contains(next) || next.closest('[role="dialog"], [role="menu"], [role="listbox"]'))) return;
        setFocused(false);
      }}
      className="relative mx-auto mt-4 mb-6 flex w-[calc(100%-48px)] max-w-[760px] flex-none flex-col gap-2 max-[767px]:mt-3 max-[767px]:mb-4 max-[767px]:w-[calc(100%-24px)]"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {showSuggestions && !text && !uploads.length && <div className="flex flex-wrap gap-2" aria-label="Suggested prompts">{["What can you help me with?", "Help me plan a task"].map(prompt => <Button key={prompt} type="button" variant="outline" size="sm" disabled={disabled || sending || dictation.phase !== "idle"} onClick={() => { setText(prompt); areaRef.current?.focus(); }}>{prompt}</Button>)}</div>}
      <label className="sr-only" htmlFor="composer-text">
        {conversationBot ? `Message ${conversationBot.name}` : "Message the room"}
      </label>
      <Popover open={open} onOpenChange={(next, details) => { if (!next && details.reason === "outside-press" && details.event.target === areaRef.current) { details.cancel(); return; } if (!next && mention) setDismissed(`${mention.start}:${mention.query}`); }}>
      {open && <PopoverContent aria-label="Agent mentions" anchor={areaRef} initialFocus={false} finalFocus={false} side="top" align="start" className="w-(--anchor-width) p-1">
        <ul className="m-0 max-h-[280px] list-none overflow-auto p-0" role="listbox" id="mention-list" aria-label={direct?"Agents":"Bots in this room"}>
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === current} id={`mention-${o.id}`}>
              <Button
                variant="ghost"
                type="button"
                tabIndex={-1}
                className={cn("w-full justify-start overflow-hidden text-left", i === current && "bg-accent text-accent-foreground")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                {o.id === "everyone" ? <span className="flex size-[22px] flex-none items-center justify-center rounded-[6px] border border-input bg-accent text-xs text-muted-foreground" aria-hidden="true">@</span> : <BotAvatar name={o.id} size={22} avatar={bots.find((x) => x.id === o.id)?.avatar} />}
                <span className="font-medium whitespace-nowrap">{o.name}</span>
                <span className="min-w-0 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-muted-foreground">{o.description}</span>
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>}
      </Popover>
      <input ref={picker} type="file" multiple accept=".txt,.md,.csv,.json,.png,.jpg,.jpeg" className="sr-only" tabIndex={-1} aria-label="Choose attachments" onChange={e => { addFiles(Array.from(e.target.files ?? []), pointerPicker.current); pointerPicker.current = false; e.target.value = ""; }} />
      <InputGroup compact={!expanded} className={cn(!expanded && "gap-2 px-2")}>
      {replyTo&&<InputGroupAddon align="block-start"><span className="min-w-0 flex-1 truncate" role="status">Replying to: {replyTo.prompt}</span><InputGroupButton type="button" variant="ghost" size="sm" onClick={replyTo.onCancel} disabled={sending}>New message</InputGroupButton></InputGroupAddon>}
      {reply && <InputGroupAddon align="block-start" aria-label="Reply preview">
        <div className="min-w-0 flex-1"><p className="mb-1 text-xs">Replying to</p><MessageQuote reply={reply} bots={bots} /></div>
        <InputGroupButton type="button" variant="ghost" size="icon-xs" aria-label="Cancel reply" disabled={sending} onClick={() => { setReply(undefined); areaRef.current?.focus(); }}><X /></InputGroupButton>
      </InputGroupAddon>}
      {dictationLabel && <InputGroupAddon align="block-start" className={cn(showDictationPrompt && "sr-only")}><span role="status" className="text-xs text-muted-foreground">{dictationLabel}</span></InputGroupAddon>}
      {uploads.length > 0 && <InputGroupAddon align="block-start"><ul className="m-0 flex min-w-0 flex-wrap gap-2 p-0" aria-label="Attachments">{uploads.map(row => <li key={row.key} className={cn("min-w-0 max-w-full list-none", row.pointerAdded && "desk-attachment-entry")}>
        <AttachmentSurface size="sm" state={row.error ? "error" : row.attachment ? "done" : "uploading"}>
          <AttachmentMedia variant={row.preview ? "image" : "icon"}>{row.preview ? <img src={row.preview} alt="" /> : <File />}</AttachmentMedia>
          <AttachmentContent><AttachmentTitle>{row.file.name}</AttachmentTitle><AttachmentDescription role="status">{row.error ?? (row.attachment ? `${row.attachment.bytes.toLocaleString()} bytes · Ready` : "Uploading…")}</AttachmentDescription></AttachmentContent>
          <AttachmentActions>
            {row.error && <AttachmentAction type="button" aria-label={`Retry ${row.file.name}`} disabled={sending || disabled} onClick={() => { changeUploads(uploadsRef.current.map(item => item.key === row.key ? { ...item, error: undefined } : item)); void upload(row); }}><RotateCw data-icon="inline-start" /></AttachmentAction>}
            <AttachmentAction type="button" aria-label={`Remove ${row.file.name}`} disabled={sending || row.removing} onClick={() => void remove(row)}><X data-icon="inline-start" /></AttachmentAction>
          </AttachmentActions>
        </AttachmentSurface>
      </li>)}</ul></InputGroupAddon>}
      <div className={cn("grid min-w-0", expanded ? "w-full" : "flex-1 basis-0")}>
        <InputGroupTextarea
          ref={areaRef}
          className="col-start-1 row-start-1 max-h-[30dvh] p-3"
          role="combobox"
          aria-expanded={open}
          aria-controls="mention-list"
          aria-autocomplete="list"
          aria-activedescendant={open ? `mention-${options[current].id}` : undefined}
          id="composer-text"
          compact={!expanded}
          rows={expanded ? 2 : 1}
          disabled={disabled}
          readOnly={sending || modelBlocked}
          aria-busy={sending}
          value={text}
          placeholder={showDictationPrompt ? "" : conversationBot ? `Message ${conversationBot.name}…` : "Message the room, @bot or @everyone…"}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); addFiles(files); } }}
        />
        {showDictationPrompt && <span aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 self-start p-3 text-base text-foreground md:text-sm dictation-prompt">{dictationLabel}</span>}
      </div>
      <InputGroupAddon align={expanded ? "block-end" : "inline-end"} className={cn("shrink-0", expanded ? "flex-wrap" : "contents")}>
        <InputGroupButton type="button" variant="ghost" size="icon-sm" className={cn("rounded-full", !expanded && "order-first")} aria-label="Attach files" disabled={disabled || sending} onClick={event => { pointerPicker.current = event.detail > 0; picker.current?.click(); }}><Plus data-icon="inline-start" /></InputGroupButton>
        <div hidden={!expanded} className={cn(expanded && "contents")}>
        {canManage && modelBot && <ChatModelSettings key={modelBot.id} ref={modelSettings} api={api} bot={modelBot} canManage={canManage} disabled={disabled || sending} onBlockedChange={setModelBlocked} onAttentionChange={setModelAttention} onSettled={focusMessage} />}
        {canManage && !modelBot && bots.length > 1 && <span className="min-w-0 flex-1 text-xs text-muted-foreground">{routed ? "Model follows room routing." : "Each agent uses its own model."}</span>}
        </div>
        {dictation.phase === "idle" ? <InputGroupButton type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label="Dictate message" disabled={disabled || sending || modelBlocked} onClick={() => void dictation.start()}><Mic data-icon="inline-start" /></InputGroupButton> : <>
          {dictation.phase === "recording" && <InputGroupButton type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label="Stop dictation" onClick={dictation.stop}><Square data-icon="inline-start" /></InputGroupButton>}
          <InputGroupButton type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label="Cancel dictation" onClick={dictation.cancel}><X data-icon="inline-start" /></InputGroupButton>
        </>}
        <InputGroupButton className="ml-auto rounded-full" variant="icon-primary" size="icon-sm" type="submit" aria-label="Send" disabled={dictation.phase !== "idle" || disabled || sending || modelBlocked || (!text.trim() && !uploads.length) || uploads.some(row => row.removing) || uploads.some(row => !row.attachment)}><ArrowUp data-icon="inline-start" /></InputGroupButton>
      </InputGroupAddon>
      </InputGroup>
      {dictation.error && <Alert variant="destructive"><AlertDescription>{dictation.error}</AlertDescription></Alert>}
      <PermissionControl showTrigger={false} ref={permissionPicker} api={api} roomId={roomId} bots={direct?bots.filter(bot=>bot.id===defaultBotId):bots} initialBotId={permissionBotId} canManage={canManage} subscribe={subscribe} />
      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}
    </form>
  );
});

/** A model choice must refer to exactly the agent this message addresses. */
export function composerModelBot(text: string, bots: readonly BotInfo[], defaultBotId?: string, routed = false): BotInfo | undefined {
  const mentions = [...text.matchAll(/(?<![^\s])@([A-Za-z0-9_-]+)/g)].map(match => match[1].toLowerCase());
  if (mentions.includes("everyone")) return undefined;
  const addressed = bots.filter(bot => mentions.includes(bot.id.toLowerCase()));
  if (addressed.length === 1) return addressed[0];
  if (addressed.length > 1 || routed) return undefined;
  return bots.find(bot => bot.id === defaultBotId) ?? (bots.length === 1 ? bots[0] : undefined);
}
