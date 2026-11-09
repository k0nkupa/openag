import { ProfileProvider } from "./profile";
import { ProfileSettings } from "./components/ProfileSettings";
import { NavigationDialogs } from "./components/NavigationDialogs";
import { confirmLeave, resolveLeave, useUnsavedChanges } from "./unsaved-changes";
import { AvatarLibraryProvider } from "./avatar-library";
import { NewRoomSheet } from "./components/NewRoomSheet";
import { NewBotSheet } from "./components/NewBotSheet";
import { ConnectorConnectReturn } from "./components/ConnectorConnectReturn";
import { AppLibraryProvider, useAppLibrary } from "./app-library";
import { AppLibraryPage } from "./components/AppLibraryPage";
import { ReceiptPage } from "./components/ReceiptView";
import { WorkPage } from "./components/WorkView";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createApi, messageOf } from "./api";
import { clearRtcIdentity, clearToken, defaultDeviceName, getRtcIdentity, getToken, setToken, readJoinInvite } from "./auth";
import { reconnectDelay, resolveTransport, type Connectivity } from "./connectivity";
import { openDirectChat } from "./directChat";
import { HomeView } from "./components/HomeView";
import { hrefFor, navigateConfirmed, navigationRevision, replaceRoute } from "./route";
import type { BotInfo } from "./types";
import { Shell } from "./components/Shell";
import { Login } from "./components/Login";
import { DevicesPage } from "./components/DevicesPage";
import { SettingsView } from "./components/SettingsView";
import { ComputerView } from "./components/ComputerView";
import { RoomView } from "./components/RoomView";
import { SettingsLayout } from "./components/SettingsLayout";
import { ModelsPage } from "./components/ModelsPage";
import { ProactivePage } from "./components/ProactivePage";
import { LedgerView } from "./components/LedgerView";
import { AutomationsView, ConnectorsView } from "./components/SectionViews";
import { useBots, useApprovals, useRoom, useRooms } from "./hooks";
import { useRoute } from "./route";
import { StreamProvider, useStream } from "./stream";
import type { Api, Whoami } from "./api";

export const REVOKED_MESSAGE = "This device was revoked or its token is no longer valid.";

export function App() {
  return <><AppSession /><NavigationDialogs /></>;
}

function AppSession() {
  const [joinInvite, setJoinInvite] = useState(readJoinInvite);
  useEffect(() => {
    if (joinInvite) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [joinInvite]);
  useEffect(() => {
    const join = () => { const invite = readJoinInvite(); if (invite) setJoinInvite(invite); };
    window.addEventListener("hashchange", join);
    return () => window.removeEventListener("hashchange", join);
  }, []);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  useEffect(() => { resolveLeave(); return () => resolveLeave(); }, [token]);
  // The token last checked against whoami. The desk renders only once the current token has been checked.
  const currentToken = useRef(token);
  currentToken.current = token;
  const [verified, setVerified] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);

  const signOut = useCallback((message: string | null = null) => {
    resolveLeave();
    currentToken.current = null;
    clearToken();
    clearRtcIdentity();
    setTokenState(null);
    setVerified(null);
    setNotice(message);
  }, []);
  const onAuthFailure = useCallback(() => {
    if (currentToken.current === token) signOut(REVOKED_MESSAGE);
  }, [signOut, token]);

  // Silent upgrade: an owner token found in storage is swapped for a device token before the desk is used.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const api = createApi(token, () => { if (!cancelled) onAuthFailure(); });
    void (async () => {
      try {
        const who = await api.whoami();
        if (cancelled) return;
        if (joinInvite?.full && who.kind === "device" && who.access === "full") setJoinInvite(null);
        if (who.kind === "owner") {
          try {
            const { token: deviceToken } = await api.createDevice(defaultDeviceName(), "full");
            if (cancelled) return;
            currentToken.current = deviceToken;
            setToken(deviceToken);
            setDeviceNotice(null);
            setTokenState(deviceToken);
            return;
          } catch (err) {
            if (!cancelled) {
              setDeviceNotice(
                `Using the owner token on this device; pairing failed: ${messageOf(err)}`,
              );
            }
          }
        }
      } catch {
        // 401 has already signed out via onAuthFailure. Other failures let the desk load and show its own errors.
      }
      if (!cancelled) setVerified(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, onAuthFailure, joinInvite]);

  if (!token || joinInvite) {
    return (
      <Login
        key={joinInvite?.code ?? "login"}
        notice={notice}
        invite={joinInvite}
        onCancel={token && joinInvite ? () => setJoinInvite(null) : undefined}
        onSignedIn={(t) => {
          currentToken.current = t;
          setJoinInvite(null);
          setNotice(null);
          setDeviceNotice(null);
          setVerified(null);
          setTokenState(t);
        }}
      />
    );
  }
  if (verified !== token) {
    return (
      <main className="mx-auto mt-[12vh] mb-0 max-w-[420px] px-4">
        <p className="text-[var(--mute)]">Checking this device...</p>
      </main>
    );
  }
  return (
    <Signed token={token} onAuthFailure={onAuthFailure} onSignOut={async () => { if (await confirmLeave()) signOut(); }} deviceNotice={deviceNotice} />
  );
}

function Signed({
  token,
  onAuthFailure,
  onSignOut,
  deviceNotice,
}: {
  token: string;
  onAuthFailure: () => void;
  onSignOut: () => void;
  deviceNotice: string | null;
}) {
  // Resolved per token. An established RTC transport that drops is re-resolved with backoff (1 s .. 30 s); the
  // stale UI stays up and the stream shows "reconnecting" until a new transport is live.
  const [conn, setConn] = useState<Connectivity | null>(null);
  const [retry, setRetry] = useState(0);
  const attempts = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let owned: Connectivity | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | null = null;
    const scheduleRetry = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (!cancelled) setRetry((r) => r + 1);
      }, reconnectDelay(attempts.current++));
    };
    void resolveTransport({ token, identity: getRtcIdentity() }).then((c) => {
      if (cancelled) {
        if (c.mode === "rtc") c.transport.close();
        return;
      }
      owned = c;
      setConn(c);
      if (c.mode === "rtc") {
        attempts.current = 0;
        // A revoked device gets 401 here and is signed out (not retried).
        void createApi(token, onAuthFailure, c.fetch)
          .whoami()
          .catch(() => undefined);
        unlisten = c.transport.onClose(scheduleRetry);
      } else if (c.error !== undefined) {
        scheduleRetry();
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
      if (owned?.mode === "rtc") owned.transport.close();
    };
  }, [token, retry, onAuthFailure]);

  const rtcTransport = conn?.mode === "rtc" ? conn.transport : null;
  const api = useMemo(
    () =>
      conn
        ? conn.mode === "rtc"
          ? createApi(token, onAuthFailure, conn.fetch, { ownerRetry: false })
          : createApi(token, onAuthFailure)
        : null,
    [conn, token, onAuthFailure],
  );
  if (!conn || !api) {
    return (
      <main className="mx-auto mt-[12vh] mb-0 max-w-[420px] px-4">
        <p className="text-[var(--mute)]">Connecting...</p>
      </main>
    );
  }
  return (
    <StreamProvider token={token} onAuthFailure={onAuthFailure} rtcTransport={rtcTransport}>
      <ProfileProvider api={api}><AvatarLibraryProvider api={api}><AppLibraryProvider api={api}><ConnectorConnectReturn api={api} /><Workspace api={api} onSignOut={onSignOut} deviceNotice={deviceNotice} via={rtcTransport ? "webrtc" : null} /></AppLibraryProvider></AvatarLibraryProvider></ProfileProvider>
    </StreamProvider>
  );
}

function Workspace({
  api,
  onSignOut,
  deviceNotice,
  via,
}: {
  api: Api;
  onSignOut: () => void;
  deviceNotice: string | null;
  via: "webrtc" | null;
}) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const route = useRoute();
  const { status,subscribe } = useStream();
  const rooms = useRooms(api, route);
  const approvals = useApprovals(api);
  const roomId = route.kind === "room" ? route.roomId : null;
  const roomState = useRoom(api, roomId);
  const library = useAppLibrary();
  const connectorCount = library.error ? null : library.data?.counts.installed ?? null;
  const [openingChat, setOpeningChat] = useState(false);
  useUnsavedChanges(false, openingChat);
  const openChat = useCallback(async (bot: BotInfo) => {
    if (!await confirmLeave() || !mounted.current) return;
    const revision = navigationRevision();
    setOpeningChat(true);
    let roomId: string;
    try {
      roomId = await openDirectChat(api, bot);
    } finally {
      // Release the pending-navigation guard before the native hashchange can ask about new edits.
      flushSync(() => setOpeningChat(false));
    }
    if (mounted.current) navigateConfirmed(hrefFor({ kind: "room", roomId }), revision);
  }, [api]);
  // The landing page replaces itself with the chat, so Back does not return to a page that would open it again.
  const openHome = useCallback(async (bot: BotInfo) => {
    const roomId = await openDirectChat(api, bot);
    if (mounted.current) await replaceRoute(hrefFor({ kind: "room", roomId }));
  }, [api]);
  const bots = useBots(api, route);
  const [identity, setIdentity] = useState<Whoami | null>(null);
  const identityRevision = useRef(0);
  const updateIdentity = useCallback((who: Whoami) => {
    identityRevision.current++;
    setIdentity(who);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const revision = ++identityRevision.current;
    api.whoami().then(
      (who) => { if (!cancelled && identityRevision.current === revision) setIdentity(who); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [api, route, status]);

  let content;
  switch (route.kind) {
    case "home":
      content = <HomeView api={api} onOpenChat={openHome} />;
      break;
    case "room":
      content = (
        <RoomView
          key={route.roomId}
          api={api}
          roomId={route.roomId}
          selectedWorkId={route.workId}
          panelTab={route.panelTab}
          selectedSetting={route.setting}
          room={roomState.room}
          bots={roomState.room?.kind==='direct'?bots:roomState.bots}
          allBots={bots}
          error={roomState.error}
          loading={roomState.loading}
          onRetry={roomState.retry}
          canManage={identity?.kind === "owner" || identity?.access === "full"}
          rooms={rooms}
          approvals={approvals.approvals}
          onDecide={approvals.decide}
          approvalsError={approvals.error}
          onRefreshApprovals={approvals.refresh}
        />
      );
      break;
    case "approval":
      content=<ReceiptPage api={api} approvalId={route.approvalId} onDecide={approvals.decide}/>;
      break;
    case "work":
      content = <WorkPage api={api} workId={route.workId} bots={bots} rooms={rooms} approvals={approvals.approvals} onDecide={approvals.decide} />;
      break;
    case "settings":
      content =
        route.section === "profile" ? (
          <ProfileSettings canManage={identity?.kind === "owner" || identity?.access === "full"} />
        ) : route.section === "devices" ? (
          <DevicesPage api={api} onSignOut={onSignOut} identity={identity} onIdentityChange={updateIdentity} deviceNotice={deviceNotice} />
        ) : route.section === "proactive" ? (
          <ProactivePage api={api} tab={route.tab} />
        ) : route.section === "models" ? (
          <ModelsPage api={api} />
        ) : route.section === "memory" ? (
          <HomeView api={api} onOpenChat={openHome} />
        ) : (
          <SettingsView api={api} canManage={identity?.kind === "owner" || identity?.access === "full"} subscribe={subscribe} />
        );
      break;
    case "computer":
      content = <ComputerView api={api} />;
      break;
    case "automations":
      content = <AutomationsView api={api} route={route} />;
      break;
    case "app-library":
      content = <AppLibraryPage api={api} integrationId={route.integrationId} />;
      break;
    case "connectors":
      content = <ConnectorsView api={api} integrationId={route.integrationId} />;
      break;
    case "bots":
      content = <BotLink api={api} botId={route.botId} onOpenChat={openHome} />;
      break;
    case "ledger":
      content = <LedgerView api={api} rooms={rooms} />;
      break;
  }

  if (route.kind === "settings" || route.kind === "connectors") {
    content = <SettingsLayout route={route}>{content}</SettingsLayout>;
  }

  return (
    <NewBotSheet api={api} identity={identity} onCreated={bot => { window.location.hash = hrefFor({ kind: "bots", botId: bot.id }); }}>
    <NewRoomSheet api={api} identity={identity} bots={bots} onCreated={room => { window.location.hash = hrefFor({ kind: "room", roomId: room.id }); }}>
    <Shell
      rooms={rooms}
      route={route}
      bots={bots}
      identity={identity}
      onOpenChat={openChat}
      connectorCount={connectorCount}
      status={status}
      via={via}
    >
      {content}
    </Shell>
    </NewRoomSheet>
    </NewBotSheet>
  );
}

/** Old bookmarks resolve to the agent conversation; no standalone settings page. */
function BotLink({ api, botId, onOpenChat }: { api: Api; botId?: string; onOpenChat: (bot: BotInfo) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.listBots().then(async ({ bots }) => {
      if (!live) return;
      const bot = botId ? bots.find(bot => bot.id === botId) : bots.find(bot => bot.isDefault) ?? bots[0];
      if (!bot) { await replaceRoute(hrefFor({ kind: "home" })); return; }
      await onOpenChat(bot);
    }).catch(error => { if (live) setError(messageOf(error)); });
    return () => { live = false; };
  }, [api, botId, onOpenChat]);
  return <p role={error ? "alert" : "status"}>{error ?? "Opening agent conversation…"}</p>;
}
