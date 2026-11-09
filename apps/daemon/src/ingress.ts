import { hasExplicitTarget, resolveTargets } from "./addressing.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import type { Room } from "./rooms.js";
import type { RoomRouter } from "./router.js";

/**
 * The one way a user message enters a room (desk, Slack, ...): append it to the ledger, resolve the target bots
 * (@mention, @everyone, the room's router for an unaddressed message, else the lead), record the route and dispatch the
 * turns without waiting for them.
 */
export interface IngressDeps {
  ledger: Ledger;
  dispatch: (args: { room: Room; botIds: string[]; message: LedgerEvent }) => Promise<void> | void;
  router?: RoomRouter;
}

export interface PostedMessage {
  message: LedgerEvent;
  route: LedgerEvent;
}

export interface PostOptions {
  /** Trusted server-owned continuation target; never copied from a request body. */
  botIds?: string[];
  /** Ledger actor of the message. Default "user". */
  actor?: string;
  /** Extra payload fields stored next to `text` (e.g. `{ source: "slack" }`). */
  extra?: Record<string, unknown>;
  /** Called synchronously with the stored message BEFORE dispatch, so a caller can register state the turn events will need. */
  onMessage?: (message: LedgerEvent) => void;
}

export function createIngress(deps: IngressDeps) {
  const { ledger } = deps;
  return {
    async post(room: Room, text: string, opts: PostOptions = {}): Promise<PostedMessage> {
      const message = ledger.atomic(() => {
        const stored = ledger.append(room.id, opts.actor ?? "user", "message", { ...opts.extra, text });
        opts.onMessage?.(stored);
        return stored;
      });
      let botIds = opts.botIds ?? resolveTargets(text, room);
      // Only a message with NO @mention in a room that opted in goes to the router; any failure answers with the lead.
      let routed: { strategy: string; reason: string; confidence?: number } | undefined;
      if (!opts.botIds && deps.router && room.router && room.router !== "lead" && !hasExplicitTarget(text, room)) {
        const decision = await deps.router.route(room, text);
        if (decision.botId) botIds = [decision.botId];
        routed = { strategy: decision.strategy, reason: decision.reason, ...(decision.confidence !== undefined ? { confidence: decision.confidence } : {}) };
      }
      const route = ledger.append(room.id, "primary", "route", { targets: botIds, messageId: message.id, ...(routed ? { router: routed } : {}) });
      // Fire and forget: the turn runs asynchronously, progress arrives via the ledger.
      void Promise.resolve(deps.dispatch({ room, botIds, message })).catch((err) => {
        ledger.append(room.id, "daemon", "error", { message: String(err instanceof Error ? err.message : err) });
      });
      return { message, route };
    },
  };
}
export type Ingress = ReturnType<typeof createIngress>;
