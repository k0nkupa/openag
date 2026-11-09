import type { LedgerEvent } from './types';

export interface ActivityItem { event: LedgerEvent; history: LedgerEvent[]; turnEnded?: boolean }
const fields = (event: LedgerEvent): Record<string, unknown> => event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Project operation lifecycles for the desk; the retained ledger stays unchanged. */
export function activityItems(events: readonly LedgerEvent[]): ActivityItem[] {
  const items: ActivityItem[] = [], calls = new Map<string, ActivityItem>(), receipts = new Map<string, ActivityItem>();
  const wrappers: { item: ActivityItem; name: string; args: unknown; completeInput: boolean; claimed: boolean }[] = [];
  const scope = (event: LedgerEvent) => canonical([event.roomId, fields(event).turnId]);
  const ended = new Set(events.filter(event => event.type === 'turn_finished').map(scope));
  const inputs = new Map(events.filter(event => event.type === 'tool_result' && fields(event).input !== undefined).map(event => [canonical([scope(event), event.actor, fields(event).toolCallId]), fields(event).input]));
  const sameArgs = (requested: unknown, effective: unknown, completeInput: boolean) => {
    if (canonical(requested) === canonical(effective)) return true;
    if (!requested || !effective || typeof requested !== 'object' || typeof effective !== 'object' || Array.isArray(requested)) return false;
    const entries = Object.entries(requested);
    return (entries.length > 0 || completeInput) && entries.every(([key, value]) => Object.hasOwn(effective, key) && canonical(value) === canonical((effective as Record<string,unknown>)[key]));
  };
  for (const event of events) {
    const p = fields(event), callKey = typeof p.toolCallId === 'string' ? canonical([scope(event), event.actor, p.toolCallId]) : undefined;
    // Receipt updates come from the daemon, while their tool-call identity belongs to the bot.
    let item = callKey ? calls.get(callKey) : undefined;
    if (event.type === 'receipt_updated') {
      item = typeof p.receiptId === 'string' ? receipts.get(p.receiptId) : undefined;
      if (typeof p.toolCallId === 'string') item ??= items.find(candidate => candidate.history.some(previous => previous.type === 'tool_call' && fields(previous).toolCallId === p.toolCallId && scope(previous) === scope(event)));
    }
    if (event.type === 'tool_call' && typeof p.tool === 'string') {
      const name = p.tool;
      const matches = wrappers.filter(candidate => !candidate.claimed && scope(candidate.item.event) === scope(event) && candidate.item.event.actor === event.actor &&
        (candidate.name === name || candidate.name === name.replace(/[^a-zA-Z0-9_-]/g, '_')) && sameArgs(candidate.args, p.args, candidate.completeInput));
      const exact = matches.filter(candidate => canonical(candidate.args) === canonical(p.args));
      const candidates = exact.length ? exact : matches;
      const wrapper = candidates.length === 1 ? candidates[0] : undefined;
      if (wrapper) { item = wrapper.item; wrapper.claimed = true; }
    }
    if (!item) { item = { event, history: [] }; items.push(item); }
    item.history.push(event);
    if (callKey && (event.type === 'tool_call' || event.type === 'tool_result')) calls.set(callKey, item);
    if (typeof p.receiptId === 'string') receipts.set(p.receiptId, item);
    if (event.type === 'tool_call' && typeof p.title === 'string') {
      const match = /^(?:mcp\.openag-[a-f0-9]+\.|mcp__openag-[a-f0-9]+__)(.+)$/.exec(p.title);
      if (match) {
        const input = (callKey ? inputs.get(callKey) : undefined) ?? p.input;
        const raw = input as Record<string, unknown> | undefined;
        const wrapped = !!raw && Object.hasOwn(raw, 'arguments');
        wrappers.push({ item, name: match[1]!, args: wrapped ? raw.arguments : raw, completeInput: wrapped || !!callKey && inputs.has(callKey), claimed: false });
      }
    }
  }
  return items.map(item => {
    const daemonResult = item.history.findLast(event => event.type === 'tool_result' && typeof fields(event).tool === 'string');
    const receipt = item.history.findLast(event => event.type === 'receipt_updated');
    const latest = daemonResult ?? receipt ?? item.history.at(-1)!;
    const p = fields(latest), call = item.history.find(event => event.type === 'tool_call' && typeof fields(event).tool === 'string');
    return { history: item.history, turnEnded: ended.has(scope(item.event)), event: { ...latest, id: item.event.id, payload: { ...p,
      ...(call ? { activityTool: fields(call).tool } : {}),
      ...(receipt ? { receiptId: fields(receipt).receiptId, executionOutcome: fields(receipt).outcome } : {}),
    } } };
  });
}
