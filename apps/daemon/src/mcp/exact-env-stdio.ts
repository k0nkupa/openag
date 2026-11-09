import { type ChildProcess, spawn } from "node:child_process";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface ExactEnvStdioOptions {
  command: string;
  args: string[];
  /** The complete child environment. Nothing from the parent is added. */
  env: Record<string, string>;
  /** Working directory for the child (a reviewed desk command uses its own directory). */
  cwd?: string;
}

const KILL_AFTER_MS = 2000;

/**
 * Stdio client transport that spawns the child with exactly `env`. The SDK's StdioClientTransport always merges
 * its own variables (LOGNAME, SHELL, USER, TERM...) into the child, which the OpenAg environment rule forbids.
 * Framing comes from the SDK's ReadBuffer/serializeMessage, so the wire format is the same.
 */
export class ExactEnvStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private proc?: ChildProcess;
  private readonly readBuffer = new ReadBuffer();
  private notified = false;
  private exited?:Promise<void>;
  private closing?:Promise<void>;

  constructor(private readonly opts: ExactEnvStdioOptions) {}

  start(): Promise<void> {
    if (this.proc) return Promise.reject(new Error("transport already started"));
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.opts.command, this.opts.args, {
        env: this.opts.env,
        ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
        stdio: ["pipe", "pipe", "ignore"],
        shell: false,
        windowsHide: true,
      });
      this.proc = proc;
      this.exited=new Promise<void>(done=>{proc.once('exit',()=>done());proc.once('error',()=>{if(proc.pid===undefined)done();});});
      proc.once("error", (err) => {
        reject(err);
        this.notifyClosed();
      });
      proc.once("spawn", () => resolve());
      proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
      proc.stdin?.on("error", (err) => this.onerror?.(err));
      proc.once("close", () => this.notifyClosed());
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return Promise.reject(new Error("not connected"));
    return new Promise<void>((resolve, reject) => {
      stdin.write(serializeMessage(message), (err) => (err ? reject(err) : resolve()));
    });
  }

  close(): Promise<void> {
    return this.closing??=this.stop();
  }

  private async stop(): Promise<void> {
    const proc = this.proc;
    if (proc?.pid !== undefined && proc.exitCode === null && proc.signalCode === null) {
      proc.stdin?.end();
      proc.kill("SIGTERM");
      const killer=setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      }, KILL_AFTER_MS);
      try { await this.exited; } finally { clearTimeout(killer); }
    }
    proc?.stdin?.destroy();proc?.stdout?.destroy();
    this.notifyClosed();
  }

  private onData(chunk: Buffer): void {
    this.readBuffer.append(chunk);
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.readBuffer.readMessage();
      } catch (err) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)));
        continue;
      }
      if (message === null) break;
      this.onmessage?.(message);
    }
  }

  private notifyClosed(): void {
    if (this.notified) return;
    this.notified = true;
    this.readBuffer.clear();
    this.onclose?.();
  }
}
