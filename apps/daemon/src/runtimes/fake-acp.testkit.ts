import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agent,
  type AgentConnection,
  methods,
  type PermissionOption,
  type RequestPermissionRequest,
  type Stream,
} from "@agentclientprotocol/sdk/unstable";

type PermissionShape = { toolCall: RequestPermissionRequest["toolCall"]; options: PermissionOption[] };
type PriorCalls = Array<{ toolCallId: string; title?: string; kind?: string; rawInput?: unknown }>;

export interface FakeAdapterOptions {
  startMode?: string;
  availableModes?: string[];
  failSetMode?: boolean;
  noResume?: boolean;
  failResume?: boolean;
  /** Overrides the permission request sent on a "create" prompt (default: a Claude-shaped Write request). */
  permission?: PermissionShape | ((server: string) => PermissionShape);
  /** tool_call updates sent before the permission request. Default: one "Write hello.txt" update for t1. */
  priorToolCalls?: PriorCalls | ((server: string) => PriorCalls);
  /** Replaces the default prompt behaviour. Returns the stop reason. */
  onPrompt?: (p: { sessionId: string; text: string; server: string; client: Parameters<Parameters<ReturnType<typeof agent>["onRequest"]>[1]>[0]["client"] }) => Promise<string>;
}

/** In-process fake ACP agent: asks permission to Write hello.txt on a prompt containing "create", and writes it only if allowed. */
export function fakeAdapter(dir: string, opts: FakeAdapterOptions = {}) {
  const log = {
    prompts: [] as string[],
    newSessions: 0,
    resumed: [] as string[],
    closed: 0,
    permissionRequests: 0,
    metas: [] as unknown[],
    /** The mcpServers list received on each session/new and session/resume, in order. */
    mcpServers: [] as unknown[],
    modeSets: [] as string[],
    chosenOptionIds: [] as string[],
  };
  let n = 0;
  // Name our MCP server was registered under in the latest session/new or session/resume ("" when none).
  let server = "";
  const serverNameOf = (list: unknown) => (Array.isArray(list) && typeof list[0]?.name === "string" ? (list[0].name as string) : "");
  const fake = agent({ name: "fake" })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { systemPrompt: {}, ...(opts.noResume ? {} : { resume: {} }) } },
    }))
    .onRequest(methods.agent.session.new, async ({ params }) => {
      log.newSessions++;
      log.metas.push(params._meta);
      log.mcpServers.push(params.mcpServers);
      server = serverNameOf(params.mcpServers);
      return {
        sessionId: `s${++n}`,
        modes: {
          currentModeId: opts.startMode ?? "auto",
          availableModes: (opts.availableModes ?? ["default", "acceptEdits", "auto"]).map((id) => ({ id, name: id })),
        },
      };
    })
    .onRequest(methods.agent.session.resume, async ({ params }) => {
      if (opts.failResume) throw new Error("no such session");
      log.resumed.push(params.sessionId);
      log.metas.push(params._meta);
      log.mcpServers.push(params.mcpServers);
      server = serverNameOf(params.mcpServers);
      return {};
    })
    .onRequest(methods.agent.session.setMode, async ({ params }) => {
      if (opts.failSetMode) throw new Error("cannot set mode");
      log.modeSets.push(params.modeId);
      return {};
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const raw = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
      // Decide on the user's words only: the openag_context block is system framing, not the request.
      const text = raw.replace(/^[\s\S]*?<\/openag_context>\s*/, "");
      log.prompts.push(text);
      if (opts.onPrompt) {
        return { stopReason: await opts.onPrompt({ sessionId: params.sessionId, text, server, client }) };
      }
      if (!text.includes("create")) {
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
        });
        return { stopReason: "end_turn" };
      }
      const rawInput = { file_path: "hello.txt", content: "hi" };
      const permission = typeof opts.permission === "function" ? opts.permission(server) : opts.permission;
      const prior = (typeof opts.priorToolCalls === "function" ? opts.priorToolCalls(server) : opts.priorToolCalls) ?? [{ toolCallId: "t1", title: "Write hello.txt", kind: "edit", rawInput }];
      for (const call of prior) {
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: "tool_call", status: "pending", ...call } as never,
        });
      }
      log.permissionRequests++;
      const options: PermissionOption[] = permission?.options ?? [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ];
      const res = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: permission?.toolCall ?? {
          toolCallId: "t1",
          title: "Write hello.txt",
          kind: "edit",
          rawInput,
          _meta: { claudeCode: { toolName: "Write" } },
        },
        options,
      });
      const chosen = res.outcome.outcome === "selected" ? res.outcome.optionId : "cancelled";
      log.chosenOptionIds.push(chosen);
      const allowed = options.some((o) => o.optionId === chosen && o.kind === "allow_once");
      if (allowed) writeFileSync(join(dir, "bots", "coder", "work", "hello.txt"), "hi");
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: allowed ? "completed" : "failed", rawOutput: allowed ? "wrote file" : "rejected" },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: allowed ? "created" : "not created" } },
      });
      return { stopReason: "end_turn" };
    });
  return { fake, log };
}

/**
 * Same fake agent, but reached over a real message stream (not in-process), so a test can drop the connection and
 * watch the runtime see it end. `hangUp()` ends the agent-to-client direction, as a crashed adapter would.
 */
export function fakeAdapterStream(dir: string, opts: FakeAdapterOptions = {}) {
  const { fake, log } = fakeAdapter(dir, opts);
  const clientToAgent = new TransformStream<unknown, unknown>();
  let push!: ReadableStreamDefaultController<unknown>;
  const agentToClient = new ReadableStream<unknown>({ start: (c) => void (push = c) });
  const agentWritable = new WritableStream<unknown>({
    write: (msg) => void push.enqueue(msg),
  });
  const clientSide = { readable: agentToClient, writable: clientToAgent.writable } as unknown as Stream;
  const agentSide = { readable: clientToAgent.readable, writable: agentWritable } as unknown as Stream;
  const agentConn: AgentConnection = fake.connect(agentSide);
  const hangUp = () => {
    try {
      push.close();
    } catch {
      // already closed
    }
  };
  return { target: clientSide, agentConn, log, hangUp };
}
