import { canonical } from "../action-receipts.js";
/** A one-time approval carried over a daemon restart: the user already approved this tool call. */
export interface Pregrant {
  toolCallId?: string;
  approvalId?: string;
  toolName: string;
  args: unknown;
}

/** Restart permission applies only to the exact reviewed payload, including content. */
export function pregrantMatches(pregrant: Pregrant, toolName: string, args: unknown): boolean {
  return pregrant.toolName===toolName && canonical(pregrant.args)===canonical(args);
}
