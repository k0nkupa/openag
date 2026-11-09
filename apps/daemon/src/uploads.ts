import { randomUUID } from "node:crypto";
import { constants, openSync, closeSync, writeFileSync, readFileSync, fstatSync, mkdirSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { getDefaultRedactor } from "./redact.js";

export const UPLOAD_FILE_MAX = 5 * 1024 * 1024;
export const UPLOAD_TEXT_MAX = 64 * 1024;
export const UPLOAD_MESSAGE_MAX = 10 * 1024 * 1024;
export const UPLOAD_COUNT_MAX = 6;
const PENDING_UPLOAD_MAX = 100 * 1024 * 1024;
const PENDING_UPLOAD_TTL = 24 * 60 * 60 * 1000;
export const attachmentIds = z.array(z.string().uuid()).max(UPLOAD_COUNT_MAX).refine(ids => new Set(ids).size === ids.length, "duplicate attachment");
const textTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
export interface Attachment { id: string; name: string; mimeType: string; bytes: number }
export interface PromptAttachment extends Attachment { text?: string; data?: string }
interface Row { id: string; room_id: string; name: string; mime_type: string; bytes: number; message_id: number | null }
const view = (row: Row): Attachment => ({ id: row.id, name: row.name, mimeType: row.mime_type, bytes: row.bytes });
export class UploadError extends Error { constructor(message: string, public status: 400 | 404 | 409 | 413 = 400) { super(message); } }
export function imageDimensions(bytes: Buffer, type: string) {
  let width = 0, height = 0;
  if (type === "image/png" && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii", 12, 16) === "IHDR") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length && bytes[offset] === 255) {
      const marker = bytes[offset + 1]!;
      if (marker === 218 || marker === 217) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += length + 2;
    }
  }
  if (!width || !height || width > 16384 || height > 16384 || width * height > 20_000_000) throw new UploadError("invalid or oversized image dimensions");
  return { width, height };
}
export function createUploads(db: Db, dataDir: string) {
  const redactor = getDefaultRedactor();
  const row = (id: string, room: string) => db.prepare("SELECT * FROM uploads WHERE id=? AND room_id=?").get(id, room) as Row | undefined;
  function folder(room: string) {
    const root = realpathSync(dataDir);
    const paths = [join(root, "uploads"), join(root, "uploads", Buffer.from(room).toString("hex"))];
    for (const path of paths) {
      mkdirSync(path, { mode: 0o700, recursive: true });
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new UploadError("unsafe upload directory");
    }
    return paths[1]!;
  }
  function read(r: Row) {
    let fd: number; try { fd = openSync(join(folder(r.room_id), r.id), constants.O_RDONLY | constants.O_NOFOLLOW); } catch { throw new UploadError("attachment is unavailable", 404); }
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size !== r.bytes || stat.size > UPLOAD_FILE_MAX) throw new UploadError("attachment is unavailable", 404); return readFileSync(fd); }
    finally { closeSync(fd); }
  }
  function select(room: string, input: unknown, messageId?: number): Row[] {
    const ids = attachmentIds.safeParse(input === undefined ? [] : input); if (!ids.success) throw new UploadError("invalid attachments (maximum six unique IDs)");
    const rows = ids.data.map(id => { const r = row(id, room); if (!r) throw new UploadError("attachment not found in this room", 404); if (r.message_id !== (messageId ?? null)) throw new UploadError("attachment already used; check the conversation before resending", 409); return r; });
    if (rows.reduce((sum, r) => sum + r.bytes, 0) > UPLOAD_MESSAGE_MAX) throw new UploadError("message attachments exceed 10 MiB", 413);
    return rows;
  }
  return {
    save(room: string, name: string, mimeType: string, input: Uint8Array): Attachment {
      if (!name.trim() || Array.from(name).length > 120 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new UploadError("invalid attachment name");
      if (!input.length || input.length > UPLOAD_FILE_MAX) throw new UploadError("file must contain 1 byte to 5 MiB", 413);
      let bytes = Buffer.from(input);
      if (textTypes.has(mimeType)) {
        let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new UploadError("text files must be UTF-8"); }
        if (text.includes("\0")) throw new UploadError("binary content is not a text file");
        bytes = Buffer.from(redactor.redactString(text));
        if (bytes.length > UPLOAD_TEXT_MAX) throw new UploadError("text file exceeds 64 KiB", 413);
      } else if (["image/png", "image/jpeg"].includes(mimeType)) imageDimensions(bytes, mimeType);
      else throw new UploadError("unsupported type; use UTF-8 text, Markdown, CSV, JSON, PNG or JPEG");
      if (bytes.length > UPLOAD_FILE_MAX) throw new UploadError("redacted file exceeds 5 MiB", 413);
      // Abandoned drafts expire on the next upload; keep their total storage bounded between visits.
      const expired = db.prepare("SELECT * FROM uploads WHERE message_id IS NULL AND created_at<?").all(Date.now() - PENDING_UPLOAD_TTL) as Row[];
      for (const r of expired) {
        const path = join(folder(r.room_id), r.id);
        try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        db.prepare("DELETE FROM uploads WHERE id=? AND message_id IS NULL").run(r.id);
      }
      const pending = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM uploads WHERE message_id IS NULL").get() as { count: number; bytes: number };
      if (pending.count >= 32 || pending.bytes + bytes.length > PENDING_UPLOAD_MAX) throw new UploadError("pending upload limit reached; send or remove existing draft attachments", 413);
      const id = randomUUID(), path = join(folder(room), id);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let written = false;
      try { writeFileSync(fd, bytes); written = true; } finally { closeSync(fd); if (!written) unlinkSync(path); }
      try { db.prepare("INSERT INTO uploads(id,room_id,name,mime_type,bytes,created_at) VALUES(?,?,?,?,?,?)").run(id, room, redactor.redactString(name.trim()), mimeType, bytes.length, Date.now()); }
      catch (error) { unlinkSync(path); throw error; }
      return view(row(id, room)!);
    },
    prepare: (room: string, input: unknown) => select(room, input).map(view),
    bind(room: string, ids: string[], messageId: number) {
      const rows = select(room, ids);
      for (const r of rows) if (db.prepare("UPDATE uploads SET message_id=? WHERE id=? AND room_id=? AND message_id IS NULL").run(messageId, r.id, room).changes !== 1) throw new UploadError("attachment already used", 409);
    },
    get(room: string, id: string) { const r = row(id, room); if (!r) throw new UploadError("attachment not found", 404); return { attachment: view(r), bytes: read(r) }; },
    remove(room: string, id: string) {
      const r = row(id, room); if (!r) throw new UploadError("attachment not found", 404); if (r.message_id !== null) throw new UploadError("message attachments cannot be removed", 409);
      const path = join(folder(room), r.id);
      try { if (lstatSync(path).isSymbolicLink()) throw new UploadError("unsafe attachment"); unlinkSync(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      db.prepare("DELETE FROM uploads WHERE id=?").run(id);
    },
    forMessage(room: string, messageId: number, ids: unknown): PromptAttachment[] {
      return select(room, ids, messageId).map(r => { const bytes = read(r); return { ...view(r), ...(textTypes.has(r.mime_type) ? { text: bytes.toString("utf8") } : { data: bytes.toString("base64") }) }; });
    },
  };
}
