import { ActionFailure } from "../action-receipts.js";
import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema, McpError, ErrorCode, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InteractionBroker, InteractionScope } from "./interactions.js";
import { INTERACTION_WAIT_MS } from "./interactions.js";
interface Active {
    scope: InteractionScope;
    broker?: InteractionBroker;
    signal: AbortSignal;
    waiting: (value: boolean) => void;
}
const channels = new WeakMap<Client, {
    tail: Promise<unknown>;
    active?: Active;
    fresh?: (signal: AbortSignal) => Promise<{ client: Client; close(): Promise<void> }>;
}>();
/** Both connector paths advertise only callbacks handled by this module. No model answers or implicit consent. */
export function createMcpClient() {
    const client = new Client({ name: 'openag', version: '1.0.0' }, { capabilities: { elicitation: { form: {}, url: {} } } });
    const channel: {
        tail: Promise<unknown>;
        active?: Active;
    } = { tail: Promise.resolve() };
    channels.set(client, channel);
    client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
        const active = channel.active;
        if (!active?.broker || active.signal.aborted || !active.scope.valid())
            return { action: 'cancel' as const };
        active.waiting(true);
        try {
            return await active.broker.request(active.scope, request.params, AbortSignal.any([active.signal, extra.signal]));
        }
        finally {
            active.waiting(false);
        }
    });
    return client;
}
export async function listMcpTools(client: Client, selected?: Tool, signal?: AbortSignal): Promise<Tool[]> {
    const tools: Tool[] = [], seen = new Set<string>();
    let cursor: string | undefined, selectedCursor: string | undefined, found = false;
    for (let page = 0; page < 20; page++) {
        const res = await client.listTools(cursor ? { cursor } : undefined, { signal });
        if (res.tools.some(tool => tool.name === selected?.name)) { selectedCursor = cursor; found = true; }
        tools.push(...res.tools);
        if (tools.length > 200) throw Error('MCP catalogue exceeds tool limit');
        if (!res.nextCursor) {
            if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw Error('duplicate remote tool name');
            if (selected) {
                const current = tools.find(tool => tool.name === selected.name);
                if (!found || !isDeepStrictEqual(current, selected)) throw new ActionFailure('Tool contract changed before MCP dispatch', 'not-run');
                // SDK listTools replaces its metadata cache on each page; prime the selected page last.
                if (selectedCursor !== cursor) {
                    const last = await client.listTools(selectedCursor ? { cursor: selectedCursor } : undefined, { signal });
                    if (!isDeepStrictEqual(last.tools.filter(tool => tool.name === selected.name), [selected])) throw new ActionFailure('Tool contract changed before MCP dispatch', 'not-run');
                }
            }
            return tools;
        }
        cursor = res.nextCursor;
        if (seen.has(cursor)) throw Error('MCP catalogue repeated a cursor');
        seen.add(cursor);
    }
    throw Error('MCP catalogue exceeds page limit');
}
/** Sessionless endpoints cannot promise that a catalogue handshake survives until a later invocation. */
export async function connectMcpHttp(url: URL, options: { signal?:AbortSignal; requestInit?: RequestInit; fetchForClient: (client: Client) => typeof fetch }) {
    const clients = new Set<Client>();
    let closed = false;
    const open = async (signal?: AbortSignal) => {
        if (closed || signal?.aborted) throw new ActionFailure('MCP connection closed before dispatch', 'not-run');
        const client = createMcpClient();
        clients.add(client);
        const abort = () => { void client.close().catch(() => {}); };
        signal?.addEventListener('abort', abort, { once: true });
        const transport = new StreamableHTTPClientTransport(url, { requestInit: options.requestInit, fetch: options.fetchForClient(client) });
        try {
            await client.connect(transport,{signal});
            if (closed || signal?.aborted) throw new ActionFailure('MCP connection closed before dispatch', 'not-run');
            return { client, transport };
        } catch (error) {
            clients.delete(client);
            await client.close().catch(() => {});
            throw error;
        } finally { signal?.removeEventListener('abort', abort); }
    };
    const { client, transport } = await open(options.signal);
    if (!transport.sessionId) channels.get(client)!.fresh = async signal => {
        const fresh = await open(signal);
        return { client: fresh.client, close: async () => { clients.delete(fresh.client); await fresh.client.close(); } };
    };
    return { client, close: async () => { if (closed) return; closed = true; await Promise.allSettled([...clients].map(value => value.close())); clients.clear(); } };
}
/** Serialize per connection: a server callback can never select a different bot/room's invocation. */
export async function invokeMcp(client: Client, scope: InteractionScope, broker: InteractionBroker | undefined, args: Record<string, unknown>, timeoutMs: number): Promise<CallToolResult> {
    let channel = channels.get(client);
    if (!channel) {
        channel = { tail: Promise.resolve() };
        channels.set(client, channel);
    }
    const current = channel;
    let dispatched = false;
    const queuedSignal = scope.context.signal;
    let rejectQueued: ((reason: unknown) => void) | undefined;
    const cancelQueued = () => { if (!dispatched)
        rejectQueued?.(new ActionFailure('Cancelled before MCP dispatch', 'not-run')); };
    const cancelled = new Promise<never>((_, reject) => { rejectQueued = reject; });
    queuedSignal?.addEventListener('abort', cancelQueued, { once: true });
    if (queuedSignal?.aborted)
        cancelQueued();
    const run = async (): Promise<CallToolResult> => {
        dispatched = true;
        queuedSignal?.removeEventListener('abort', cancelQueued);
        const abort = new AbortController(), signal = scope.context.signal ? AbortSignal.any([abort.signal, scope.context.signal]) : abort.signal;
        if (signal.aborted)
            throw new ActionFailure('Cancelled before MCP dispatch', 'not-run');
        if (!(scope.dispatchValid ?? scope.valid)())
            throw new ActionFailure('Tool contract changed before MCP dispatch', 'not-run');
        if (current.fresh) {
            let connection: Awaited<ReturnType<NonNullable<typeof current.fresh>>>;
            try { connection = await current.fresh(AbortSignal.any([signal, AbortSignal.timeout(15000)])); }
            catch { throw new ActionFailure('MCP session negotiation failed before tool dispatch', 'not-run'); }
            try {
                try { await listMcpTools(connection.client, scope.contract, AbortSignal.any([signal, AbortSignal.timeout(15000)])); }
                catch { throw new ActionFailure('MCP catalogue validation failed before tool dispatch', 'not-run'); }
                return await invokeMcp(connection.client, scope, broker, args, timeoutMs);
            }
            finally { await connection.close().catch(() => {}); }
        }
        let timer: ReturnType<typeof setTimeout> | undefined, reviewTimer: ReturnType<typeof setTimeout> | undefined, remaining = timeoutMs, reviewRemaining = INTERACTION_WAIT_MS, reviewStarted = 0, started = Date.now(), waits = 0, finished = false;
        const arm = () => { started = Date.now(); timer = setTimeout(() => abort.abort(Error('MCP tool timed out')), remaining); };
        const waiting = (value: boolean) => { if (finished)
            return; if (value) {
            if (waits++ === 0) {
                clearTimeout(timer);
                remaining -= Date.now() - started;
                reviewStarted = Date.now();
                reviewTimer = setTimeout(() => abort.abort(Error('MCP human response deadline exceeded')), reviewRemaining);
            }
        }
        else if (waits > 0 && --waits === 0) {
            clearTimeout(reviewTimer);
            reviewRemaining -= Date.now() - reviewStarted;
            if (!signal.aborted)
                arm();
        } };
        const hard = setTimeout(() => abort.abort(Error('MCP invocation deadline exceeded')), timeoutMs + INTERACTION_WAIT_MS);
        current.active = { scope: { ...scope, deadline: Date.now() + timeoutMs + INTERACTION_WAIT_MS, valid: () => !finished && scope.valid() }, broker, signal, waiting };
        arm();
        try {
            return await client.callTool({ name: scope.toolName, arguments: args }, undefined, { signal, timeout: timeoutMs + INTERACTION_WAIT_MS }) as CallToolResult;
        }
        catch (error) {
            if (!(error instanceof McpError) || error.code !== ErrorCode.UrlElicitationRequired)
                throw error;
            const entries = (error.data as {
                elicitations?: unknown;
            })?.elicitations;
            const responses: {
                elicitationId: string;
                action: string;
            }[] = [];
            if (Array.isArray(entries) && entries.length <= 4 && broker) {
                for (const entry of entries) {
                    const parsed = ElicitRequestSchema.safeParse({ method: 'elicitation/create', params: { ...entry, mode: 'url' } });
                    if (!parsed.success || parsed.data.params.mode !== 'url')
                        continue;
                    waiting(true);
                    try {
                        const decision = await broker.request(current.active!.scope, parsed.data.params, signal);
                        responses.push({ elicitationId: parsed.data.params.elicitationId, action: decision.action });
                        if (decision.action !== "accept")
                            break;
                    }
                    finally {
                        waiting(false);
                    }
                }
            }
            return { isError: true, content: [{ type: 'text', text: 'The provider requires an external user interaction. The tool invocation was not replayed; review its evidence before a new proposal.' }], structuredContent: { code: 'url_elicitation_required', responses } };
        }
        finally {
            const interrupted = signal.aborted;
            finished = true;
            clearTimeout(timer);
            clearTimeout(reviewTimer);
            clearTimeout(hard);
            current.active = undefined;
            abort.abort(Error("Invocation ended"));
            if (interrupted) {
                await new Promise(resolve => setTimeout(resolve, 25));
                await client.close().catch(() => { });
            }
        }
    };
    const pending = current.tail.then(run, run);
    current.tail = pending.catch(() => { });
    try {
        return await Promise.race([pending, cancelled]);
    }
    finally {
        queuedSignal?.removeEventListener('abort', cancelQueued);
    }
}
/** Only the parent tool POST shares its invocation deadline; cancellation messages must still be sent. */
export function mcpRequestSignal(client: Client, init?: RequestInit): AbortSignal | undefined {
    if (typeof init?.body !== "string") return;
    try { if (JSON.parse(init.body).method === "tools/call") return channels.get(client)?.active?.signal; }
    catch { /* SDK protocol parsing remains authoritative. */ }
}
/** Header timeout only: a live SSE body can legitimately wait for a human response. */
export async function boundedMcpFetch(input: string | URL | Request, init: RequestInit = {}, fetcher: typeof fetch = fetch, invocationSignal?: AbortSignal): Promise<Response> {
    const deadline = new AbortController();
    const timer = invocationSignal ? undefined : setTimeout(() => deadline.abort(Error('MCP connection timed out')), 15000);
    let response: Response;
    try {
        response = await fetcher(input, { ...init, signal: AbortSignal.any([deadline.signal, ...(invocationSignal ? [invocationSignal] : []), ...(init.signal ? [init.signal] : [])]) });
    }
    finally {
        clearTimeout(timer);
    }
    if (!response.body)
        return response;
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, output) { bytes += chunk.byteLength; if (bytes > 2 * 1024 * 1024)
            throw Error('MCP response too large'); output.enqueue(chunk); } }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
