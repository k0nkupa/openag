import { canonical } from '../action-receipts.js';
import { type PermissionSession } from '../permissions.js';
import type { PermissionRequirement } from '../tools/registry.js';
import type { Approvals, Decision } from "../approvals.js";
import type { Db } from "../db/index.js";
import { classify, sessionToolMode,operationClass } from "../policy.js";
import type { AuthorizeResult, GateOptions } from "./types.js";

export interface GateRequest {
  toolCallId?: string;
  review?: Record<string,unknown>;
  roomId: string;
  botId: string;
  turnId: string;
  toolName: string;
  args: unknown;
  /** Where the turn came from (e.g. "slack:U0123"); shown with the approval. */
  source?: string | null;
  permission?: { session: PermissionSession; requirement: PermissionRequirement; approvalPolicy?: 'ask'|'never' };
}

export interface ToolGate {
  /**
   * `preapproved` may satisfy an `ask`, once. It never overrides `deny`, so policy still wins.
   * It is only called when the mode is `ask`, and should consume the grant when it returns true.
   * `opts` bounds the approval wait (abort signal, max wait); without it the wait is unbounded, as before.
   */
  authorize(
    req: GateRequest,
    preapproved?: (toolName: string, args: unknown) => boolean | string,
    opts?: GateOptions,
  ): Promise<AuthorizeResult>;
}

/** The single policy gate: every tool call from every runtime goes through here. */
export function createToolGate(deps: { db: Db; approvals: Approvals }): ToolGate {
  return {
    async authorize(req, preapproved, opts) {
      req={...req,args:structuredClone(req.args)};
      const toolClass = req.permission?operationClass(req.toolName,req.permission.requirement):classify(req.toolName);
      const requirement = req.permission?.requirement;
      const resolved=req.permission?sessionToolMode(req.permission.approvalPolicy??req.permission.session.approvalPolicy,requirement??{approval:'review'}):undefined;
      const mode=resolved?.mode??'deny';
      if (mode === "auto") return { allowed: true, args: req.args };
      if (mode === "deny") {
        return { allowed: false, status: "denied", message: resolved?.reason ?? `${req.toolName} (${toolClass}) is denied by policy` };
      }
      const grant=preapproved?.(req.toolName,req.args);
      const previous=typeof grant==='string'?deps.approvals.get(grant):undefined;
      const scopedGrant=!req.permission||(previous?.review?.permissionSessionId===req.permission.session.id&&previous.review.permissionRevision===req.permission.session.revision&&canonical(previous.review.permissionParents??[])===canonical(req.review?.permissionParents??[]));
      if(grant&&scopedGrant)return {allowed:true,args:req.args,...(typeof grant==="string"?{approvalId:grant}:{})};
      const { approvalId, wait } = deps.approvals.request({
        roomId: req.roomId,
        botId: req.botId,
        turnId: req.turnId,
        toolCallId: req.toolCallId,
        toolName: req.toolName,
        toolClass,
        payload: req.args,
        review:req.review,
        source: req.source,
      });
      const decision = opts ? await boundedWait(deps.approvals, approvalId, wait, opts) : await wait();
      if (decision === undefined) {
        return { allowed: false, status: "ignored", message: "approval expired before the user decided" };
      }
      switch (decision.kind) {
        case "accept":
          return { allowed: true, args: req.args, approvalId };
        case "edit":
          return { allowed: true, args: decision.payload, approvalId };
        case "respond":
          return { allowed: false, status: "responded", message: decision.text };
        case "ignore":
          return { allowed: false, status: "ignored", message: "The user ignored this request" };
      }
    },
  };
}

/**
 * Resolves with the user's decision, or with undefined when the bound (abort or max wait) fired first and the
 * approval was expired by this call. If the user decided in the same instant, the decision wins and is returned.
 */
async function boundedWait(
  approvals: Approvals,
  approvalId: string,
  wait: () => Promise<Decision>,
  opts: GateOptions,
): Promise<Decision | undefined> {
  const decided = wait().then((d) => ({ d }));
  let fire!: () => void;
  const bound = new Promise<null>((resolve) => (fire = () => resolve(null)));
  const onAbort = () => fire();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.maxWaitMs !== undefined) timer = setTimeout(fire, opts.maxWaitMs);
  if (opts.signal) {
    if (opts.signal.aborted) fire();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  let won: { d: Decision } | null;
  try {
    won = await Promise.race([decided, bound]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  if (won) return won.d;
  if (opts.keepPending?.()) return undefined;
  if (approvals.expire(approvalId, "wait bound reached")) return undefined;
  // Not pending any more: a decision landed first. Its waiter was settled synchronously, so this resolves at once.
  return (await decided).d;
}
