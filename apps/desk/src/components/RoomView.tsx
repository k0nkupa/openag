import { useConversationRequests } from "../conversation-requests";
import { ConversationRequests } from "./ConversationRequests";
import { useAvatarMoods } from "../avatar-activity";
import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2, SlidersHorizontal } from "lucide-react";
import { messageOf, type Api } from "../api";
import { useLedger } from "../hooks";
import { type RoomPanelTab, type BotSettingSection, hrefFor } from "../route";
import { useStream } from "../stream";
import { useWorkItem, useWorkList } from "../work-hooks";
import type { Approval, BotInfo, Decision, Room, WorkQuestion, LedgerEvent } from "../types";
import { Composer, type ComposerHandle } from "./Composer";
import { AgentRequestsPanel } from "./AgentRequestsPanel";
import { Feed } from "./Feed";
import { RoomSummary } from "./RoomRail";
import { WorkCard, WorkInspector } from "./WorkView";
import { BotAvatar } from "./BotAvatar";
import { BotSettings } from "./BotSettings";
import { RoomSettings } from "./RoomSettings";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export function RoomView({
  api,
  roomId,
  selectedWorkId,
  panelTab,
  selectedSetting,
  room,
  bots,
  allBots = bots,
  error,
  rooms,
  approvals,
  onDecide,
  approvalsError,
  onRefreshApprovals,
  loading = false,
  onRetry,
  canManage = false,
}: {
  api: Api;
  roomId: string;
  selectedWorkId?: string;
  panelTab?: RoomPanelTab;
  selectedSetting?: BotSettingSection;
  room: Room | null;
  bots: BotInfo[];
  allBots?: BotInfo[];
  error: string | null;
  rooms: Room[];
  approvals: Approval[];
  onDecide: (id: string, decision: Decision) => Promise<void>;
  approvalsError?:string|null;
  onRefreshApprovals?:()=>Promise<void>;
  loading?: boolean;
  onRetry?: () => void;
  /** Owner or full-access device: only they can save room settings. */
  canManage?: boolean;
}) {
  const ledger = useLedger(api, roomId),
    { status,subscribe } = useStream();
  const moods = useAvatarMoods(ledger.events, approvals.filter(a => a.roomId === roomId));

  const composer = useRef<ComposerHandle>(null);
  const [attachmentsAvailable, setAttachmentsAvailable] = useState(false);
  const [fileDrag, setFileDrag] = useState(false);
  const dragDepth = useRef(0);
  const clearFileDrag = useCallback(() => { dragDepth.current = 0; setFileDrag(false); }, []);
  useEffect(() => { clearFileDrag(); }, [attachmentsAvailable, roomId, clearFileDrag]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") clearFileDrag(); };
    window.addEventListener("blur", clearFileDrag);
    window.addEventListener("dragend", clearFileDrag);
    window.addEventListener("drop", clearFileDrag);
    window.addEventListener("hashchange", clearFileDrag);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("blur", clearFileDrag);
      window.removeEventListener("dragend", clearFileDrag);
      window.removeEventListener("drop", clearFileDrag);
      window.removeEventListener("hashchange", clearFileDrag);
      window.removeEventListener("keydown", cancel);
    };
  }, [clearFileDrag]);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const [inspectorContainer,setInspectorContainer] = useState<HTMLElement|null>(null);
  const requests=useConversationRequests(api,roomId);
  const replySelection=useRef(0);
  const [replyError,setReplyError]=useState<string>();
  const [selectedReply,setSelectedReply]=useState<WorkQuestion|null|undefined>();
  useEffect(()=>setSelectedReply(undefined),[roomId]);
  const questions=requests.requests.flatMap(request=>request.question?[request.question]:[]);
  useEffect(()=>{if(canManage&&selectedReply===undefined&&questions.length===1&&!requests.cursor&&questions[0].roomId===roomId&&!composer.current?.hasDraft())setSelectedReply(questions[0]);},[questions,selectedReply,requests.cursor,roomId,canManage]);
  const reply=canManage&&selectedReply?.roomId===roomId?selectedReply:null;
  const selectReply=(question:WorkQuestion)=>{if(!canManage||composer.current?.isSending())return;replySelection.current++;setReplyError(undefined);setSelectedReply(question);composer.current?.focus();};
  const cancelReply=()=>{if(composer.current?.isSending())return;replySelection.current++;setReplyError(undefined);setSelectedReply(null);};
  const quoteMessage=(message:LedgerEvent)=>{if(composer.current?.isSending())return;cancelReply();composer.current?.replyTo(message);};
  const replyToMessage=async(message:LedgerEvent)=>{
    if(composer.current?.isSending())return;
    const id=message.actor!=='user'?(message.payload as {questionId?:string}).questionId:undefined;
    if(!id||!canManage){quoteMessage(message);return;}
    const selected=++replySelection.current;
    try{
      const question=questions.find(q=>q.id===id)??(await api.getQuestion(id)).question;
      if(selected!==replySelection.current||!composer.current||composer.current.isSending())return;
      if(question.status==='open'&&question.roomId===roomId)selectReply(question);else quoteMessage(message);
    }catch(error){if(selected===replySelection.current)setReplyError(messageOf(error));}
  };
  const visibleQuestions=new Set(ledger.events.flatMap(event=>{const id=(event.payload as {questionId?:unknown}|null)?.questionId;return event.type==='message'&&event.actor!=='user'&&typeof id==='string'?[id]:[];}));
  const send = useCallback(async(text:string,attachments:string[],replyToMessageId?:number)=>{
    replySelection.current++;
    await api.sendMessage(roomId,text,attachments,replyToMessageId,reply?{id:reply.id,revision:reply.revision}:undefined);
    if(reply){setSelectedReply(null);requests.refresh();}
  },[api,roomId,reply]);
  const directBot =
    room?.kind === "direct"
      ? bots.find((bot) => bot.id === room.members[0])
      : undefined;
  const contextTab = panelTab ?? (selectedWorkId || !directBot ? "work" : "settings");
  const selectContext = (tab: string, setting?: BotSettingSection) => { window.location.hash = hrefFor({kind: "room", roomId, workId: selectedWorkId, panelTab: tab as RoomPanelTab, setting}); };
  const roomWork = useWorkList(api, { roomId }, !!room),
    botWork = useWorkList(api, { botId: directBot?.id }, !!directBot),
    selected = useWorkItem(api, selectedWorkId);
  const contextWork = directBot ? botWork : roomWork;
  const pending = approvals.filter((approval) => approval.roomId === roomId);
  const [wide, setWide] = useState(
      () => matchMedia("(min-width:1180px)").matches,
    ),
    [open, setOpen] = useState(() => !!selectedWorkId || !!panelTab);
  useEffect(() => {
    const media = matchMedia("(min-width:1180px)"),
      update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (selectedWorkId) setOpen(true);
  }, [selectedWorkId]);
  const previousAddressedPanel = useRef(!!panelTab || !!selectedWorkId);
  useEffect(() => { const addressed = !!panelTab || !!selectedWorkId; if (addressed) setOpen(true); else if (previousAddressedPanel.current) setOpen(false); previousAddressedPanel.current = addressed; }, [panelTab, selectedSetting, selectedWorkId]);
  function changeOpen(next: boolean) { if (next) selectContext(contextTab, selectedSetting); else if (panelTab || selectedWorkId) window.location.hash = hrefFor({kind: "room", roomId}); else setOpen(false); }
  const select = (workId?: string) => {
    window.location.hash = hrefFor({ kind: "room", roomId, workId, panelTab: "work" });
    if (workId) setOpen(true);
  };
  const inScope =
    selected.item &&
    (directBot
      ? selected.item.botId === directBot.id
      : selected.item.roomId === roomId);
  const item = inScope ? selected.item : undefined;
  const selectionError =
    selected.item && !inScope
      ? "This Work is outside this conversation’s context."
      : selected.error;
  const title = directBot?.name ?? `#${room?.name ?? roomId}`;
  const collection = (
    <div className="flex flex-col gap-5">
      {room && (
        <RoomSummary
          api={api}
          room={room}
          bots={bots}
          approvals={pending}
          events={ledger.events}
        />
      )}
      <section
        className="flex flex-col gap-3"
        aria-label={directBot ? `${directBot.name} Work` : "Room Work"}
      >
        <h3 className="text-sm font-medium">
          {directBot ? `${directBot.name}’s Work` : "Room Work"}
        </h3>
        <p className="text-[13px] text-muted-foreground">
          {directBot
            ? "Across public rooms. Each item keeps its originating room."
            : "Shared Work in this room."}
        </p>
        {contextWork.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {contextWork.error}
              <Button variant="outline" size="sm" onClick={contextWork.refresh}>
                Retry Work
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {contextWork.items.map((work) => (
          <WorkCard
            key={work.id}
            item={work}
            bots={bots}
            rooms={rooms}
            onSelect={select}
            compact
          />
        ))}
        {!contextWork.items.length &&
          !contextWork.loading &&
          !contextWork.error && (
            <p className="text-sm text-muted-foreground">No Work here yet.</p>
          )}
        {contextWork.loading && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Updating Work…
          </p>
        )}
        {contextWork.cursor !== null && (
          <Button
            variant="outline"
            disabled={contextWork.loading}
            onClick={contextWork.more}
          >
            Older Work
          </Button>
        )}
      </section>
    </div>
  );
  const context = (
    <div className="min-w-0 p-4">
      {selectedWorkId && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 min-h-11"
          onClick={() => select()}
        >
          All {directBot ? `${directBot.name} Work` : "room Work"}
        </Button>
      )}
      {selectionError && (
        <Alert variant="destructive">
          <AlertDescription>
            {selectionError}
            <Button variant="outline" size="sm" onClick={selected.refresh}>
              Retry details
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {selected.loading ? (
        <p role="status">Loading Work…</p>
      ) : (
        <WorkInspector
          key={directBot?.id ?? roomId}
          api={api}
          item={item}
          bots={bots}
          rooms={rooms}
          approvals={approvals}
          onDecide={onDecide}
          onChanged={selected.apply}
          scope={directBot ? { botId: directBot.id } : { roomId }}
          active={open}
        empty={collection}
          tab={contextTab}
          onTabChange={tab => selectContext(tab)}
          extraTabs={directBot ? [{ value: "settings", label: "Settings", content: <BotSettings key={directBot.id} api={api} bot={directBot} roomId={roomId} canManage={canManage} subscribe={subscribe} selectedSection={selectedSetting} onSelectSection={setting => selectContext("settings", setting)} /> }] : room && canManage ? [{ value: "settings", label: "Room settings", icon: <SlidersHorizontal className="size-4" />, content: <RoomSettings api={api} room={room} bots={allBots} /> }] : undefined}
        />
      )}
    </div>
  );
  return (
    <Sheet open={open} modal={!wide} disablePointerDismissal={wide} onOpenChange={changeOpen}>
      <section ref={setInspectorContainer} className="flex h-full min-h-0 min-w-0 flex-row" aria-labelledby="room-title">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 md:px-7">
            {new URLSearchParams(window.location.search).get("desk") !== "classic" && <SidebarTrigger />}
            <h1 id="room-title" className="m-0 flex min-w-0 items-center gap-2.5 text-lg leading-[22px] font-semibold [overflow-wrap:anywhere]">
              {directBot && (
                <BotAvatar
                  name={directBot.id}
                  size={24}
                  avatar={directBot.avatar}
                  mood={moods.get(directBot.id)}
                />
              )}{" "}
              {loading ? "Loading conversation…" : title}
            </h1>
            {!directBot && <span className="text-[13px] text-muted-foreground max-md:order-1 max-md:basis-full">
              {room?.description ? `${room.description} · ` : ""}{room?.router && room.router !== "lead"
                ? `Routed by ${room.router} unless you @mention`
                : "Lead answers unless you @mention"}
            </span>}
            <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={
                <Button ref={panelToggle} variant="ghost" size="icon" className="min-h-11 min-w-11"
                  aria-label={open ? "Close side panel" : "Open side panel"}
                  aria-expanded={open} aria-controls="conversation-context"
                  onClick={() => changeOpen(!open)} />
              }>
                <Settings2 />
              </TooltipTrigger>
              <TooltipContent>{open ? "Close side panel" : "Open side panel"}</TooltipContent>
            </Tooltip>
            </div>
          </header>
          <div
            className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden [&>[role=alert]]:mx-4 [&>[role=alert]]:mt-3 [&>[role=alert]]:w-auto [&>[role=alert]]:shrink-0"
            onDragEnter={(e) => {
              if (attachmentsAvailable && e.dataTransfer.types.includes("Files")) {
                dragDepth.current++;
                setFileDrag(true);
              }
            }}
            onDragLeave={() => {
              if (dragDepth.current > 0 && --dragDepth.current === 0) setFileDrag(false);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              clearFileDrag();
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                composer.current?.addFiles(Array.from(e.dataTransfer.files), true);
              }
            }}
          >
            <div aria-hidden="true" data-file-drop-active={fileDrag && attachmentsAvailable} className="desk-file-drop-cue pointer-events-none absolute inset-2 z-10 rounded-xl border-2 border-primary" />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  Could not load room: {error}{" "}
                  {onRetry && (
                    <Button variant="outline" size="sm" onClick={onRetry}>
                      Retry conversation
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {ledger.error && (
              <Alert variant="destructive">
                <AlertDescription>
                  Could not load history: {ledger.error}
                  <Button variant="outline" size="sm" onClick={ledger.retry}>
                    Retry history
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <Feed
              canManage={canManage}
              api={api}
              requests={<ConversationRequests canManage={canManage} api={api} requests={requests.requests} approvals={pending} bots={bots} onDecide={onDecide} onReply={selectReply} visibleQuestions={visibleQuestions} refresh={()=>{setReplyError(undefined);requests.refresh();void onRefreshApprovals?.();}} error={replyError??requests.error??approvalsError??undefined} more={requests.cursor?requests.more:undefined}/>}
              events={ledger.events}
              bots={bots}
              approvals={pending}
              onDecide={onDecide}
              loading={ledger.loading}
              error={ledger.error}
              works={roomWork.items}
              rooms={rooms}
              onOpenWork={select}
              onReply={message=>void replyToMessage(message)}
            />
            {roomWork.cursor !== null && (
              <Button
                variant="ghost"
                size="sm"
                disabled={roomWork.loading}
                onClick={roomWork.more}
              >
                Load older conversation Work cards
              </Button>
            )}
            <AgentRequestsPanel key={roomId} canManage={canManage} api={api} roomId={roomId} events={ledger.events} bots={bots}/>
            <Composer
              ref={composer}
              onAttachmentAvailabilityChange={setAttachmentsAvailable}
              api={api}
              roomId={roomId}
              onSend={send}
              replyTo={reply?{botId:reply.botId,prompt:reply.prompt??reply.context,onCancel:cancelReply}:undefined}
              showSuggestions={!ledger.loading && !ledger.events.some(event => event.type === "message" || event.type === "bot_output")}
              canManage={canManage}
              permissionBotId={reply?.botId??directBot?.id??room?.leadBotId??undefined}
              subscribe={subscribe}
              direct={room?.kind==='direct'}
              bots={room?.kind==='direct'?bots:bots.filter(bot=>room?.members.includes(bot.id))}
              defaultBotId={directBot?.id ?? room?.leadBotId ?? undefined}
              routed={!directBot && !!room?.router && room.router !== "lead"}
              disabled={
                status !== "live" || loading || !!error || !!ledger.error
              }
            />
          </div>
        </div>
        {inspectorContainer && <SheetContent
          keepMounted
          portalContainer={inspectorContainer}
          id="conversation-context"
          showBackdrop={!wide}
          showCloseButton={!wide}
          initialFocus={wide ? false : undefined}
          finalFocus={panelToggle}
          role={wide ? "complementary" : "dialog"}
          aria-label={wide ? `${directBot?.name ?? "Room"} Work context` : undefined}
          side="right"
          style={wide ? { width: directBot ? "min(560px,45vw)" : 360 } : undefined}
          className={wide ? "!relative !inset-auto !h-full !max-w-none shrink-0 !translate-x-0 overflow-auto border-l border-border bg-card !shadow-none !transition-none" : "overflow-y-auto"}
        >
          <SheetHeader className={wide ? "sr-only" : undefined}>
            <SheetTitle className="break-words">{item?.title ?? title}</SheetTitle>
            <SheetDescription>Settings, Work, saved results, computer and activity</SheetDescription>
          </SheetHeader>
          {context}
        </SheetContent>}
      </section>
    </Sheet>
  );
}
