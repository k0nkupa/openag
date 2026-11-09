import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ElicitRequest, ElicitResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "../db/index.js";
import type { Ledger } from "../ledger.js";
import type { ToolExecContext } from "../tools/registry.js";
import { getDefaultRedactor } from "../redact.js";
export const INTERACTION_WAIT_MS = 120000;
export interface InteractionScope {
    serverId: string;
    toolName: string;
    contract?: Tool;
    context: ToolExecContext;
    deadline?: number;
    valid: () => boolean;
    dispatchValid?: () => boolean;
}
export interface InteractionBroker {
    request(scope: InteractionScope, params: ElicitRequest['params'], signal: AbortSignal): Promise<ElicitResult>;
}
interface Row {
    id: string;
    revision: string;
    server_id: string;
    room_id: string;
    bot_id: string;
    turn_id: string;
    tool_call_id: string;
    work_id: string | null;
    tool_name: string;
    request_json: string;
    response_json: string | null;
    status: string;
    created_at: number;
    expires_at: number;
    decided_at: number | null;
}
export class InteractionError extends Error {
    constructor(message: string, public status: 400 | 404 | 409 = 409) { super(message); }
}
export function interactionForm(schema: unknown): z.ZodType {
    const object = schema as {
        properties?: Record<string, unknown>;
    };
    if (!object?.properties || Object.keys(object.properties).length > 32)
        throw new InteractionError("Unsupported interaction form", 400);
    for (const [name, field] of Object.entries(object.properties))
        if (/password|secret|(?:access|refresh|auth|bearer|session)[ _-]*token|api[ _-]*key|credential|card[ _-]*number|\btoken\b/i.test(name + " " + String((field as {
            title?: unknown;
        })?.title ?? "") + " " + String((field as {
            format?: unknown;
        })?.format ?? "")))
            throw new InteractionError("Credentials require an external URL interaction", 400);
    const clean = JSON.parse(JSON.stringify({ ...schema as Record<string, unknown>, additionalProperties: false }, (key, value) => key === 'default' ? undefined : value));
    return z.fromJSONSchema(clean as Parameters<typeof z.fromJSONSchema>[0]);
}
export function interactionUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 4096)
        throw new InteractionError("Unsupported interaction URL", 400);
    return url.href;
}
export function createMcpInteractions(db: Db, ledger: Ledger, { waitMs = INTERACTION_WAIT_MS }: {
    waitMs?: number;
} = {}) {
    const redactor = getDefaultRedactor();
    const pending = new Map<string, {
        scope: InteractionScope;
        url?: string;
        settle: (result: ElicitResult, status: string) => void;
    }>();
    const row = (id: string) => db.prepare('SELECT * FROM mcp_interactions WHERE id=?').get(id) as Row | undefined;
    const view = (r: Row) => ({ id: r.id, revision: r.revision, serverId: r.server_id, roomId: r.room_id, botId: r.bot_id, turnId: r.turn_id, toolCallId: r.tool_call_id, workId: r.work_id, toolName: r.tool_name, request: JSON.parse(r.request_json), response: r.response_json ? JSON.parse(r.response_json) : null, status: r.status, expiresAt: r.expires_at, ...(r.status === 'open' && pending.get(r.id)?.url ? { url: pending.get(r.id)!.url } : {}) });
    const changed = (r: Row) => ledger.append(r.room_id, r.bot_id, 'mcp_interaction_updated', { interactionId: r.id, turnId: r.turn_id, toolCallId: r.tool_call_id, serverId: r.server_id, status: r.status });
    return {
        get(id: string) { const r = row(id); return r ? view(r) : undefined; },
        hasOpen(turnId: string) { return db.prepare("SELECT 1 FROM mcp_interactions WHERE turn_id=? AND status='open'").get(turnId) !== undefined; },
        recover() { for (const value of [...pending.values()])
            value.settle({ action: 'cancel' }, 'interrupted'); for (const r of db.prepare("SELECT * FROM mcp_interactions WHERE status='open'").all() as Row[]) {
            db.prepare("UPDATE mcp_interactions SET status='interrupted',decided_at=? WHERE id=? AND status='open'").run(Date.now(), r.id);
            changed(row(r.id)!);
        } },
        async request(scope: InteractionScope, params: ElicitRequest['params'], signal: AbortSignal): Promise<ElicitResult> {
            const ctx = scope.context;
            const turn = ctx.turnId ? db.prepare('SELECT bot_id,room_id,status,state_json FROM turns WHERE id=?').get(ctx.turnId) as {
                bot_id: string;
                room_id: string;
                status: string;
                state_json: string;
            } | undefined : undefined;
            const state = JSON.parse(turn?.state_json ?? '{}');
            if (!turn || turn.status !== 'running' || turn.bot_id !== ctx.botId || turn.room_id !== ctx.roomId || !ctx.toolCallId || state.unattended || state.isolated || ctx.turnPolicy?.unattended || ctx.turnPolicy?.isolated || signal.aborted || !scope.valid())
                return { action: 'cancel' };
            if ((db.prepare("SELECT count(*) n FROM mcp_interactions WHERE turn_id=? AND tool_call_id=?").get(ctx.turnId, ctx.toolCallId) as {
                n: number;
            }).n >= 16)
                return { action: 'cancel' };
            if ((db.prepare("SELECT count(*) n FROM mcp_interactions WHERE turn_id=? AND tool_call_id=? AND status='open'").get(ctx.turnId, ctx.toolCallId) as {
                n: number;
            }).n >= 4)
                return { action: 'cancel' };
            if (JSON.stringify(params).length > 16000)
                return { action: 'cancel' };
            let url: string | undefined;
            try {
                if (params.mode === 'url')
                    url = interactionUrl(params.url);
                else
                    interactionForm(params.requestedSchema);
            }
            catch {
                return { action: 'cancel' };
            }
            const id = randomUUID(), revision = randomUUID(), now = Date.now(), ttl = Math.max(0, Math.min(waitMs, (scope.deadline ?? Infinity) - Date.now()));
            // URLs may carry provider credentials. Keep them in memory only, never in SQLite or the ledger.
            const request = redactor.redact(params.mode === 'url' ? { mode: 'url', message: params.message.replace(/https?:\/\/\S+/g, '[provider URL]'), elicitationId: params.elicitationId, host: new URL(url!).host } : { mode: 'form', message: params.message, requestedSchema: params.requestedSchema });
            return new Promise(resolve => {
                let finished = false;
                let timer: ReturnType<typeof setTimeout>;
                const abort = () => settle({ action: 'cancel' }, 'cancelled');
                const settle = (result: ElicitResult, status: string) => {
                    if (finished)
                        return;
                    finished = true;
                    clearTimeout(timer);
                    signal.removeEventListener('abort', abort);
                    db.prepare("UPDATE mcp_interactions SET status=?,response_json=?,decided_at=? WHERE id=? AND status='open'").run(status, JSON.stringify(redactor.redact(result)), Date.now(), id);
                    pending.delete(id);
                    changed(row(id)!);
                    resolve(result);
                };
                db.prepare("INSERT INTO mcp_interactions(id,revision,server_id,room_id,bot_id,turn_id,tool_call_id,work_id,tool_name,request_json,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,'open',?,?)").run(id, revision, scope.serverId, ctx.roomId!, ctx.botId, ctx.turnId!, ctx.toolCallId!, ctx.workId ?? null, scope.toolName, JSON.stringify(request), now, now + ttl);
                pending.set(id, { scope, url, settle });
                timer = setTimeout(() => settle({ action: 'cancel' }, 'expired'), ttl);
                signal.addEventListener('abort', abort, { once: true });
                changed(row(id)!);
                if (signal.aborted)
                    abort();
            });
        },
        respond(id: string, revision: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) {
            const r = row(id), current = pending.get(id);
            if (!r)
                throw new InteractionError('Interaction not found', 404);
            if (r.revision !== revision || r.status !== 'open' || !current)
                throw new InteractionError('This interaction is no longer open');
            const parent = db.prepare('SELECT status FROM turns WHERE id=? AND room_id=? AND bot_id=?').get(r.turn_id, r.room_id, r.bot_id) as {
                status: string;
            } | undefined;
            if (parent?.status !== 'running' || Date.now() >= r.expires_at || !current.scope.valid() || current.scope.context.signal?.aborted) {
                current.settle({ action: 'cancel' }, 'expired');
                throw new InteractionError('This interaction expired');
            }
            const request = JSON.parse(r.request_json);
            let response: ElicitResult = { action };
            if (action === 'accept' && request.mode === 'form') {
                const value = interactionForm(request.requestedSchema).safeParse(content);
                if (!value.success || JSON.stringify(value.data).length > 16000)
                    throw new InteractionError('The response does not match the requested form', 400);
                if (JSON.stringify(redactor.redact(value.data)) !== JSON.stringify(value.data))
                    throw new InteractionError('Do not submit credentials in an interaction form', 400);
                response = { action, content: value.data as ElicitResult['content'] };
            }
            current.settle(response, action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled');
            return view(row(id)!);
        },
        close() { for (const value of [...pending.values()])
            value.settle({ action: 'cancel' }, 'interrupted'); },
    };
}
export type McpInteractions = ReturnType<typeof createMcpInteractions>;
