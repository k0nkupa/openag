import { z } from "zod";
import type { Db } from "../db/index.js";
import { getBot, getRoom } from "../rooms.js";
import { getSetting } from "../settings.js";
import { modelConfig, modelOverride, modelRevision, INVALID_MODEL_OVERRIDE } from "../botmodels.js";
import { getDefaultRedactor } from "../redact.js";
import type { ToolDef } from "./registry.js";

/** Public feature flags and the caller's own model/permissions only; no general settings or HTTP proxy. */
export function createOpenagStatusTool(db?: Db): ToolDef {
  return {
    name: "openag_status", permission:()=>({approval:'allow'}), offlineSafe:true,
    effectScope:()=>({kind:'read'}),class: "read",
    description: "Read current bot permissions and requested/last-reported model in this room, plus heartbeat/reflection/brief enabled flags. Read-only; no provider probes. Does not expose other-room data or prove model sign-in/runtime success.",
    input: z.object({}).strict(),
    enabled: () => db !== undefined,
    async execute(ctx) {
      if (!db) return { unavailable: true, reason: "Status access unavailable" };
      const bot = getBot(db, ctx.botId), room = ctx.roomId ? getRoom(db, ctx.roomId) : undefined;
      if (!bot || !room?.members.includes(bot.id)) return { unavailable: true, reason: "Current bot/room context unavailable" };
      const rows = db.prepare("SELECT ts,payload_json FROM events WHERE id IN (SELECT max(id) FROM events WHERE actor=? AND room_id=? AND type='model_report' AND json_extract(payload_json,'$.source') IN ('session','response') GROUP BY json_extract(payload_json,'$.source')) ORDER BY id DESC LIMIT 2").all(bot.id, room.id) as { ts: number; payload_json: string }[];
      const override = modelOverride(bot);
      const requested = override === INVALID_MODEL_OVERRIDE ? null : override ?? (bot.runtime === "api" ? bot.model : modelConfig(bot).model ?? null);
      const text = (v: unknown, max: number) => typeof v === "string" ? getDefaultRedactor().redactString(v).slice(0, max) : null;
      return {
        observedAt: Date.now(),
        scope: "Current bot and room; installation-wide non-sensitive enabled flags only",
        untrusted: true,
        botId: bot.id,
        model: {
          runtime: bot.runtime,
          requested: text(requested, 200),
          administratorOverride: override !== null,
          unavailableReason: override === INVALID_MODEL_OVERRIDE ? INVALID_MODEL_OVERRIDE : requested === null ? "Requested model not reported" : null,
          reports: rows.map(row => {
            const report = JSON.parse(row.payload_json);
            return {
              source: report.source as "session" | "response",
              at: row.ts,
              model: text(report.model, 200),
              effort: text(report.effort, 80),
              freshness: report.revision === modelRevision(bot) ? "last-reported" : "previous-configuration",
            };
          }),
        },
        permissions: {filesystem:ctx.permission??null,approvalPolicy:ctx.permissionApproval??null,adoptionRequired:!ctx.permission},
        features: {
          heartbeat: { enabled: getSetting(db, "heartbeat").enabled },
          reflection: { enabled: getSetting(db, "reflection").enabled },
          brief: { enabled: getSetting(db, "brief").enabled },
        },
      };
    },
  };
}
