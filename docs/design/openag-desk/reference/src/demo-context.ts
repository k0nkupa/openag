import { createContext, useContext } from "react";
import type { Approval, Automation, BotId, Entry } from "./data";
import type { AppLibraryState } from "./app-library-state";
import type { WorkState } from "./work-state";

export type LocalMessage = { id: string; bot: BotId | "owner"; text: string; room: string };
export type DemoState = WorkState & AppLibraryState & {
  route: string; go: (path: string) => void; approvals: Approval[]; decide: (id: string, status: Approval["status"], body?: string) => void;
  messages: LocalMessage[]; send: (text: string, room: string) => void; ledger: Entry[]; automations: Automation[]; setAutomations: (items: Automation[]) => void;
  control: "agent" | "paused" | "human"; setControl: (control: "agent" | "paused" | "human") => void;
  attentionCount: number; notice: string; announce: (text: string) => void;
};
export const DemoContext = createContext<DemoState | null>(null);
export const useDemo = () => useContext(DemoContext)!;
