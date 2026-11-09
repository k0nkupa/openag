import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { avatarFrame, validateAvatar, type AvatarDefinition } from 'open-bot-avatar';
import type { Db } from './db/index.js';
import type { Ledger } from './ledger.js';
import { getDefaultRedactor } from './redact.js';

export const customAvatarRef = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const avatarInput = z.object({
  version: z.literal(1), id: z.string().min(1).max(40), name: z.string().min(1).max(40),
  body: z.object({ path: z.string().min(1).max(6000) }).strict(),
  eyes: z.object({ x: z.number().finite(), y: z.number().finite(), spacing: z.number().finite(), scale: z.number().finite() }).strict(),
}).strict();
type Row = { id: string; bot_id: string; room_id: string; definition_json: string; added_at: number | null };
export class AvatarError extends Error {}
export interface AvatarScope { botId: string; roomId: string; turnId: string; toolCallId: string }
export function createAvatarLibrary(db: Db, ledger: Ledger) {
  const get = (id: string) => db.prepare('SELECT * FROM avatar_designs WHERE id=?').get(id) as Row | undefined;
  const safeToRead = (row: Row) => getDefaultRedactor().redactString(row.definition_json) === row.definition_json;
  const view = (row: Row) => ({ id: `custom:${row.id}` as const, previewId: row.id, definition: JSON.parse(row.definition_json) as AvatarDefinition, added: row.added_at !== null });
  function draft(scope: Pick<AvatarScope, 'botId' | 'roomId'>, id: string) {
    const row = get(id);
    if (!row || !safeToRead(row) || row.bot_id !== scope.botId || row.room_id !== scope.roomId) throw new AvatarError('Avatar preview is unavailable in this conversation.');
    return row;
  }
  return {
    list() { return (db.prepare('SELECT * FROM avatar_designs WHERE added_at IS NOT NULL ORDER BY added_at,id LIMIT 200').all() as Row[]).filter(safeToRead).map(view); },
    has(ref: string) { const row = customAvatarRef.test(ref) ? get(ref.slice(7)) : undefined; return !!row && row.added_at !== null && safeToRead(row); },
    preview(scope: AvatarScope, raw: unknown) {
      if (scope.roomId.startsWith('_')) throw new AvatarError('Avatar previews require an ordinary conversation.');
      if (!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?').get(scope.roomId, scope.botId)) throw new AvatarError('Agent is not a member of this conversation.');
      const parsed = avatarInput.parse(raw);
      const safe = getDefaultRedactor().redactString(JSON.stringify(parsed));
      if (safe !== JSON.stringify(parsed)) throw new AvatarError('Avatar definition contains sensitive material.');
      const result = validateAvatar(parsed);
      if (!result.ok) throw new AvatarError('Invalid avatar geometry: ' + result.errors.join('; '));
      avatarFrame(result.value, { reducedMotion: true });
      const json = JSON.stringify(result.value);
      if (getDefaultRedactor().redactString(json) !== json) throw new AvatarError("Normalized avatar contains sensitive material.");
      return ledger.atomic(() => {
        const previous = db.prepare('SELECT * FROM avatar_designs WHERE turn_id=? AND tool_call_id=?').get(scope.turnId, scope.toolCallId) as Row | undefined;
        if (previous) {
          if (previous.bot_id !== scope.botId || previous.room_id !== scope.roomId || previous.definition_json !== json) throw new AvatarError('This preview call already has a different design.');
          return view(previous);
        }
        // shortcut: Unapproved drafts are retained up to 500; add owner cleanup if that limit becomes restrictive.
        if ((db.prepare('SELECT count(*) n FROM avatar_designs WHERE added_at IS NULL').get() as { n: number }).n >= 500) throw new AvatarError('Avatar draft limit reached.');
        const id = randomUUID();
        db.prepare('INSERT INTO avatar_designs(id,bot_id,room_id,turn_id,tool_call_id,definition_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id, scope.botId, scope.roomId, scope.turnId, scope.toolCallId, json, Date.now());
        const preview = view(get(id)!);
        ledger.append(scope.roomId, scope.botId, 'avatar_preview', preview);
        return preview;
      });
    },
    review(scope: Pick<AvatarScope, 'botId' | 'roomId'>, id: string) {
      const row = draft(scope, id);
      return { previewId: id, avatarDefinition: JSON.parse(row.definition_json), avatarHash: createHash('sha256').update(row.definition_json).digest('hex') };
    },
    add(scope: Pick<AvatarScope, 'botId' | 'roomId'>, id: string, review: Record<string, unknown> | null | undefined) {
      const row = draft(scope, id);
      if (review?.previewId !== id || review.avatarHash !== createHash('sha256').update(row.definition_json).digest('hex')) throw new AvatarError('Avatar needs its exact reviewed preview.');
      return ledger.atomic(() => {
        const current = get(id)!;
        if (current.added_at !== null) return view(current);
        if ((db.prepare('SELECT count(*) n FROM avatar_designs WHERE added_at IS NOT NULL').get() as { n: number }).n >= 200) throw new AvatarError('Avatar library is full.');
        const bytes = (db.prepare('SELECT coalesce(sum(length(CAST(definition_json AS BLOB))),0) bytes FROM avatar_designs WHERE added_at IS NOT NULL').get() as {bytes:number}).bytes;
        if (bytes + Buffer.byteLength(row.definition_json) > 256 * 1024) throw new AvatarError('Avatar library geometry allowance reached.');
        db.prepare('UPDATE avatar_designs SET added_at=? WHERE id=?').run(Date.now(), id);
        ledger.append(scope.roomId, scope.botId, 'avatar_library_updated', { id: `custom:${id}`, name: JSON.parse(row.definition_json).name });
        return view(get(id)!);
      });
    },
  };
}
export type AvatarLibrary = ReturnType<typeof createAvatarLibrary>;
