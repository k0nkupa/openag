import type { BotInfo, MessageReply } from '../types';
import { useProfile } from '../profile';

export function MessageQuote({ reply, bots = [] }: { reply: MessageReply; bots?: readonly BotInfo[] }) {
  const { profile } = useProfile();
  const name = reply.actor === 'user' ? profile.name : bots.find(bot => bot.id === reply.actor)?.name ?? reply.actor;
  return <blockquote aria-label={`Quoted message from ${name}`} className="min-w-0 border-l-2 border-border pl-3 text-sm">
    <p className="truncate font-medium">{name}</p>
    <p className="line-clamp-2 whitespace-pre-wrap wrap-anywhere text-muted-foreground">{reply.text}</p>
  </blockquote>;
}

export function storedMessageReply(value: unknown): MessageReply | undefined {
  if (!value || typeof value !== 'object') return;
  const reply = value as MessageReply;
  if (Number.isSafeInteger(reply.messageId) && reply.messageId > 0 && typeof reply.actor === 'string' && typeof reply.text === 'string') return reply;
}
