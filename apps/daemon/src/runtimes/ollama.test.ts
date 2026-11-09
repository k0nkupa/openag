import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { ToolDef } from "../tools/registry.js";
import { cleanReply, createOllamaRuntime, ollamaModelOf, OllamaError } from "./ollama.js";
import { createApiRuntime } from "./api.js";
import type { BotRuntime, ToolOutcome, TurnContext } from "./types.js";

const ok = (message: unknown) => new Response(JSON.stringify({ done:true,done_reason:'stop',message }), { status: 200 });

interface Call {
  url: string;
  init: RequestInit;
  body: { model: string; messages: Array<{ role: string; content: string; tool_name?: string }>; stream: boolean; tools?: Array<{ function: { name: string; parameters: unknown } }> };
}
function setup(replies: Array<Response | Error>, over: { env?: NodeJS.ProcessEnv; tools?: ToolDef[]; model?: string | null; maxRounds?: number } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    const r = replies.shift();
    if (!r) throw new Error("no reply");
    if (r instanceof Error) throw r;
    return r;
  });
  const outputs: string[] = [];
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  const callTool = async (name: string, args: unknown): Promise<ToolOutcome> => {
    toolCalls.push({ name, args });
    return { ok: true, result: { echoed: args } };
  };
  const ctx = {
    bot: { id: "local", name: "Local", runtime: "api", model: over.model === undefined ? "ollama/qwen3:8b" : over.model, config: {} },
    room: { id: "main", name: "main", members: ["local"], leadBotId: "local" },
    prompt: "hello there",
    hostedInput: { instructions: "You are Local, a bot in OpenAg. Be brief.", current: "hello there", data: [], history: [] },
    state:{},saveState(patch:Record<string,unknown>){Object.assign(this.state,patch);},
    turnId: "t1",
    // The runtime also appends request/model telemetry events; only bot_output carries the answer.
    ledger: { append: (_room: string, _actor: string, type: string, payload: { text: string }) => { if (type === "bot_output") outputs.push(payload.text); } },
    callTool,
  } as unknown as TurnContext;
  const runtime = createOllamaRuntime({ fetch: fetchMock as unknown as typeof fetch, env: over.env ?? {}, tools: over.tools ?? [], maxRounds: over.maxRounds });
  return { runtime, ctx, calls, outputs, toolCalls, fetchMock };
}
const echoTool: ToolDef = { name: "echo", class: "read", description: "echoes", input: z.object({ text: z.string() }), async execute() { return {}; } };

describe("model selection and configuration", () => {
  test("a bot uses Ollama only when its model is ollama/<name>; the env override wins; bad names are refused", () => {
    expect(ollamaModelOf("local", "ollama/qwen3:8b", {})).toBe("qwen3:8b");
    expect(ollamaModelOf("local", "ollama/huihui_ai/qwen3.5-abliterated:9b", {})).toBe("huihui_ai/qwen3.5-abliterated:9b");
    expect(ollamaModelOf("local", "openai/gpt-4o-mini", {})).toBeNull();
    expect(ollamaModelOf("local", null, {})).toBeNull();
    expect(ollamaModelOf("local", "openai/x", { OPENAG_LOCAL_MODEL: "ollama/llama3.2" })).toBe("llama3.2");
    for (const bad of ["ollama/", "ollama/-x", "ollama/a b", "ollama/a;rm", `ollama/${"x".repeat(200)}`]) expect(ollamaModelOf("local", bad, {})).toBeNull();
  });

  test("the URL defaults to loopback, comes from OPENAG_OLLAMA_URL (NOT the embedding settings), and refuses credentials and odd schemes", async () => {
    const d = setup([ok({ content: "hi" })]);
    await d.runtime.runTurn(d.ctx);
    expect(d.calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    const other = setup([ok({ content: "hi" })], { env: { OPENAG_OLLAMA_URL: "http://10.0.0.5:11434", OPENAG_EMBED_MODEL: "ignored", OLLAMA_HOST: "http://ignored" } });
    await other.runtime.runTurn(other.ctx);
    expect(other.calls[0]!.url).toBe("http://10.0.0.5:11434/api/chat");
    for (const bad of ["ftp://x", "http://u:p@h", "not a url", "file:///etc/passwd"]) {
      const s = setup([], { env: { OPENAG_OLLAMA_URL: bad } });
      await expect(s.runtime.runTurn(s.ctx)).rejects.toThrow(/OPENAG_OLLAMA_URL/);
      expect(s.fetchMock).not.toHaveBeenCalled();
    }
  });

  test("a bot without an ollama model fails before any request", async () => {
    const s = setup([], { model: "openai/gpt" });
    await expect(s.runtime.runTurn(s.ctx)).rejects.toThrow(/no valid ollama model/);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});

describe("a plain turn", () => {
  test("sends the model, a system message and the prompt (non-streaming), no auth header, and records the answer", async () => {
    const s = setup([ok({ content: "Hello! 2+2=4." })]);
    await s.runtime.runTurn(s.ctx);
    expect(s.calls[0]!.body.model).toBe("qwen3:8b");
    expect(s.calls[0]!.body.stream).toBe(false);
    expect(s.calls[0]!.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(s.calls[0]!.body.messages[1]!.content).toBe("hello there");
    expect(s.calls[0]!.body.tools).toBeUndefined();
    expect(Object.keys(s.calls[0]!.init.headers as object)).toEqual(["content-type"]);
    expect(s.calls[0]!.init.redirect).toBe("error");
    expect(s.outputs).toEqual(["Hello! 2+2=4."]);
  });

  test("reasoning blocks are removed from the answer", () => {
    expect(cleanReply("<think>secret plan</think>The answer is 4.")).toBe("The answer is 4.");
    expect(cleanReply("<think>never closed ... ")).toBe("");
    expect(cleanReply("plain")).toBe("plain");
    // Real output of a local qwen model: reasoning without an opening tag.
    expect(cleanReply("17 times 3 = 21\n</think>\n\n21")).toBe("21");
  });
});

describe("tools go through the gate", () => {
  test("a tool call is executed ONLY via ctx.callTool and its result is fed back", async () => {
    const s = setup([ok({ content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "x" } } }] }), ok({ content: "done" })], { tools: [echoTool] });
    await s.runtime.runTurn(s.ctx);
    expect(s.toolCalls).toEqual([{ name: "echo", args: { text: "x" } }]);
    expect(s.calls[0]!.body.tools![0]!.function.name).toBe("echo");
    const second = s.calls[1]!.body.messages;
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(second[3]).toMatchObject({ tool_name: "echo" });
    expect(JSON.parse(second[3]!.content)).toEqual({ ok:true,result: { echoed: { text: "x" } } });
    expect(s.outputs).toEqual(["done"]);
  });

  test("unknown and prototype-named tools are refused without touching the gate", async () => {
    const calls = ["constructor", "__proto__", "toString", "nope"].map((name) => ({ function: { name, arguments: {} } }));
    const s = setup([ok({ content: "", tool_calls: calls }), ok({ content: "ok" })], { tools: [echoTool] });
    await s.runtime.runTurn(s.ctx);
    expect(s.toolCalls).toEqual([]);
    for (const m of s.calls[1]!.body.messages.filter((x) => x.role === "tool")) expect(JSON.parse(m.content)).toEqual({ error: "unknown tool" });
  });

  test("model requests stop incomplete at their step cap", async () => {
    const loop = () => ok({ content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "again" } } }] });
    const s = setup([loop(), loop(), loop(), ok({ content: "gave up" })], { tools: [echoTool], maxRounds: 2 });
    expect(await s.runtime.runTurn(s.ctx)).toEqual({outcome:"incomplete",reason:"step_limit"});
    expect(s.calls).toHaveLength(2);
    expect(s.toolCalls).toHaveLength(2);
  });

  test("all requested tools in a batch reach the gate", async () => {
    const many = Array.from({ length: 10 }, () => ({ function: { name: "echo", arguments: { text: "y".repeat(50) } } }));
    const s = setup([ok({ content: "", tool_calls: many }), ok({ content: "k" })], { tools: [echoTool] });
    await s.runtime.runTurn(s.ctx);
    expect(s.toolCalls).toHaveLength(10);
  });
});

describe("fail soft", () => {
  test.each([
    ["Ollama is down", new TypeError("fetch failed"), /not reachable/],
    ["the model is not installed (404)", new Response('{"error":"model \\"x\\" not found"}', { status: 404 }), /not installed \(run: ollama pull qwen3:8b\)/],
    ["a server error", new Response("boom sk-abcdefghijklmnopqrstuvwxyz0123", { status: 500 }), /ollama error 500/],
    ["a non-JSON answer", new Response("<html>", { status: 200 }), /unexpected response/],
    ["an answer without a message", new Response("{}", { status: 200 }), /unexpected response/],
    ["a timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), /timed out/],
  ])("%s becomes one short, fixed error", async (_n, reply, re) => {
    const replies=reply instanceof Response&&reply.status===500?[reply.clone(),reply.clone(),reply]:[reply as Response];
    const s = setup(replies);
    const outcome=await s.runtime.runTurn(s.ctx);
    expect(outcome).toMatchObject({outcome:'failed',reason:'provider_error'});
    if(reply instanceof Response&&reply.status===404)expect(outcome&&outcome.message).toMatch(re);
    expect(JSON.stringify(outcome)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(s.outputs).toEqual([]);
  });

  test("an oversized answer is refused", async () => {
    const s = setup([new Response("x".repeat(10), { status: 200, headers: { "content-length": "9999999999" } })]);
    // The cap is enforced on the stream, so build a body larger than the cap.
    const big = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9 * 1024 * 1024)); c.close(); } }), { status: 200 });
    const t = setup([big]);
    expect(await t.runtime.runTurn(t.ctx)).toMatchObject({outcome:'failed',reason:'provider_error'});
    void s;
  });
});

describe("api runtime dispatch", () => {
  test("a bot on ollama/<name> goes to the ollama runtime and never builds a Mastra agent; others do not", async () => {
    const ollama: BotRuntime = { runTurn: vi.fn(async () => undefined) };
    const api = createApiRuntime({ ollama });
    const ctx = { bot: { id: "local", name: "Local", model: "ollama/qwen3:8b" }, room: { name: "main" } } as unknown as TurnContext;
    await api.runTurn(ctx);
    expect(ollama.runTurn).toHaveBeenCalledTimes(1);
    const other = { bot: { id: "x", name: "X", model: null }, room: { name: "main" } } as unknown as TurnContext;
    await expect(api.runTurn(other)).rejects.toThrow(/no model configured/);
    expect(ollama.runTurn).toHaveBeenCalledTimes(1);
  });
});

import { isOllamaBot } from "./ollama.js";
describe("isOllamaBot", () => {
  test("dispatches on the prefix even when the name is invalid, and honours the env override", () => {
    expect(isOllamaBot("local", "ollama/bad name!", {})).toBe(true);
    expect(isOllamaBot("local", "openai/gpt-4o-mini", {})).toBe(false);
    expect(isOllamaBot("local", "openai/gpt-4o-mini", { OPENAG_LOCAL_MODEL: "ollama/qwen3" })).toBe(true);
  });
});
