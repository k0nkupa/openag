// Standalone presentation check; no unit runner or live service.
import assert from "node:assert/strict";
import { isVisibleWork } from "../apps/desk/src/work-visibility.ts";

const chat = { status: "completed", parentId: null, delegationId: null, plan: [], progress: { tools: 0, turns: 1 } };
assert.equal(isVisibleWork(chat), true, "persisted historical Work remains visible");
assert.equal(isVisibleWork({ ...chat, status: "working" }), true, "persisted active Work remains visible");
for (const status of ["needs_input", "needs_approval", "failed", "interrupted", "cancelled"])
  assert.equal(isVisibleWork({ ...chat, status }), true, status);
for (const patch of [
  { parentId: "parent" }, { delegationId: "delegation" }, { continuedFrom: "previous" },
  { attentionCount: 1 }, { plan: [{ title: "Step", state: "completed" }] },
  { progress: { tools: 1, turns: 1 } }, { progress: { unknownTools: 1, turns: 1 } },
  { progress: { tools: 0, turns: 2 } },
]) for (const status of ["working", "completed"])
  assert.equal(isVisibleWork({ ...chat, status, ...patch }), true, status + " " + JSON.stringify(patch));
console.log("Conversation Work visibility passed: persisted Work is authoritative regardless of activity; chat absence is enforced by the daemon.");
