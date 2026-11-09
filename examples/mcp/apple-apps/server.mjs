// Curated read surface over mcp-icloud@2.1.3; never expose the upstream registry to agents.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';

export function mailReadScript({ uid, folder = 'inbox' }) {
  const mailboxes = { inbox: 'INBOX', sent: 'Sent Messages', drafts: 'Drafts', trash: 'Deleted Messages', archive: 'Archive', junk: 'Junk' };
  if (typeof uid !== 'string' || !/^\d{1,16}$/.test(uid) || !Number.isSafeInteger(Number(uid)) || !Object.hasOwn(mailboxes, folder)) throw Error('Invalid Mail reference');
  return `(function () {
    const mail = Application('Mail');
    for (const account of mail.accounts()) {
      const mailbox = account.mailboxes.byName(${JSON.stringify(mailboxes[folder])});
      if (!mailbox.exists()) continue;
      const msg = mailbox.messages.byId(${Number(uid)});
      if (!msg.exists()) continue;
      return JSON.stringify({ id: msg.id(), subject: msg.subject(), from: msg.sender(), to: msg.toRecipients().map(r => r.address()), cc: msg.ccRecipients().map(r => r.address()), date: msg.dateReceived().toISOString(), body: msg.content(), read: msg.readStatus() });
    }
    return JSON.stringify(null);
  })();`;
}

export function notesListScript({ folderName, count = 25 }) {
  if (!Number.isInteger(count) || count < 1 || count > 50 || (folderName !== undefined && typeof folderName !== 'string')) throw Error('Invalid Notes request');
  return `(function () {
    const folders = Application('Notes').folders;
    const names = folders.name(), candidates = [];
    if (${JSON.stringify(folderName ?? null)} !== null && !names.includes(${JSON.stringify(folderName ?? null)})) throw Error('Notes folder unavailable');
    for (let i = 0; i < names.length; i++) {
      if (${JSON.stringify(folderName ?? null)} !== null && names[i] !== ${JSON.stringify(folderName ?? null)}) continue;
      const items = folders[i].notes;
      // Fail the read if a collection is unavailable; never report partial data as complete.
      const ids = items.id();
      if (!ids.length) continue;
      const dates = items.modificationDate();
      for (let j = 0; j < ids.length; j++) candidates.push({ id: ids[j], folderIndex: i, modificationDate: dates[j].toISOString() });
    }
    candidates.sort((a, b) => Date.parse(b.modificationDate) - Date.parse(a.modificationDate));
    return JSON.stringify(candidates.slice(0, ${count}).map(item => {
      const note = folders[item.folderIndex].notes.byId(item.id);
      return { id: item.id, name: note.name(), creationDate: note.creationDate().toISOString(), modificationDate: item.modificationDate, folder: names[item.folderIndex] };
    }));
  })();`;
}

export function notesScript({ noteId, query, count = 25 }) {
  return `(function () {
    const folders = Application('Notes').folders();
    const found = [];
    for (const folder of folders) {
      for (const note of folder.notes()) {
        const id = note.id(), name = note.name();
        if (${JSON.stringify(noteId ?? null)} !== null) {
          if (id === ${JSON.stringify(noteId ?? null)}) return JSON.stringify({ id, name, folder: folder.name(), plaintext: note.plaintext() });
        } else if ((name + '\\n' + note.plaintext()).toLowerCase().includes(${JSON.stringify((query ?? '').toLowerCase())})) {
          found.push({ id, name, folder: folder.name() });
          if (found.length >= ${count}) return JSON.stringify(found);
        }
      }
    }
    return JSON.stringify(${noteId ? 'null' : 'found'});
  })();`;
}

export function appleInputShapes(z) {
  const text = z.string().min(1).max(500).regex(/^[^\u0000-\u001f]*$/);
  const count = z.number().int().min(1).max(50).default(25);
  const folder = z.enum(['inbox', 'sent', 'drafts', 'trash', 'archive', 'junk']).default('inbox');
  return {
    'list-emails': { folder, count },
    'read-email': { uid: z.string().regex(/^\d{1,16}$/), folder },
    'search-emails': { query: text, folder, count },
    'list-folders': {},
    'list-events': { count, daysAhead: z.number().int().min(1).max(365).default(30) },
    'list-calendars': {},
    'list-contacts': { count },
    'search-contacts': { query: text, count },
    'read-contact': { contactUrl: text },
    'list-reminder-lists': {},
    'list-reminders': { listName: text.optional(), includeCompleted: z.boolean().default(false), count },
    'search-reminders': { query: text, count },
    'list-note-folders': {},
    'list-notes': { folderName: text.optional(), count },
    'read-note': { noteId: text },
    'search-notes': { query: text, count },
    'list-chats': { limit: count },
    'read-messages': { chatId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), limit: count },
    'list-safari-tabs': {},
    'get-current-safari-url': {},
  };
}

export async function createAppleServer(daemonRoot, handlers) {
  const require = createRequire(join(daemonRoot, 'package.json'));
  const { McpServer } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href);
  const { z } = require('zod');
  const shapes = appleInputShapes(z);
  const server = new McpServer({ name: 'OpenAg Apple apps (read only)', version: '1.0.0' });
  for (const [name, shape] of Object.entries(shapes)) {
    if (!Object.hasOwn(handlers, name)) {
      if (name === 'list-chats' || name === 'read-messages') continue;
      throw Error('Required Apple operation is missing');
    }
    const schema = z.object(shape).strict();
    server.registerTool(name, { description: `Read-only Apple apps: ${name}`, inputSchema: schema }, async args => {
      const parsed = schema.parse(args);
      try {
        const result = await handlers[name](parsed);
        // Only text crosses this boundary; never forward paths/resources or upstream instructions.
        // The daemon knows registered secrets: it must redact the complete text before truncation.
        const output = JSON.stringify(result);
        if (output.length > 2 * 1024 * 1024) throw Error('Apple result too large');
        return { content: [{ type: 'text', text: output }], ...(result?.isError ? { isError: true } : {}) };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Apple read failed. Check app permission and availability on the daemon Mac.' }] };
      }
    });
  }
  return server;
}

export function localHandlers(daemonRoot) {
  if (process.platform !== 'darwin') throw Error('Apple apps require macOS');
  const require = createRequire(join(daemonRoot, 'package.json'));
  const upstream = createRequire(require.resolve('mcp-icloud/package.json'));
  if (upstream('./package.json').version !== '2.1.3') throw Error('Apple package version differs from reviewed pin');
  // Restrict child environment and bound the upstream AppleScript executor before any client imports it.
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const run = (script, jxa = false) => new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/osascript', jxa ? ['-l', 'JavaScript', '-'] : ['-'], { env, timeout: 25000, maxBuffer: 1024 * 1024 }, (err, stdout) => err ? reject(Error('Apple operation failed')) : resolve(stdout.trim()));
    child.stdin.on('error', () => {});
    child.stdin.end(script);
  });
  const scripts = upstream('./utils/applescript');
  scripts.runAppleScript = script => run(script);
  scripts.runJXA = script => run(script, true);
  // Avoid upstream body/snippet truncation before the daemon's redactor sees complete strings.
  upstream('./config').DEFAULTS.EMAIL_BODY_MAX_LENGTH = Number.MAX_SAFE_INTEGER;
  const notes = upstream('./notes/local-client');
  notes.readNote = async noteId => JSON.parse(await run(notesScript({ noteId }), true));
  notes.searchNotes = async (query, count) => JSON.parse(await run(notesScript({ query, count }), true));
  const safari = upstream('./safari/local-client');
  safari.getCurrentUrl = async () => JSON.parse(await run(`(function () { const tab = Application('Safari').windows[0].currentTab(); return JSON.stringify({ name: tab.name(), url: tab.url() }); })();`, true));
  upstream('./mode').setMode('local');
  const all = [...upstream('./email').emailTools, ...upstream('./calendar').calendarTools, ...upstream('./contacts').contactsTools, ...upstream('./reminders').remindersTools, ...upstream('./notes').notesTools, ...upstream('./safari').safariTools];
  const hasImsg = ['/opt/homebrew/bin/imsg', '/usr/local/bin/imsg', ...(process.env.PATH ?? '').split(':').filter(p => p.startsWith('/')).map(p => join(p, 'imsg'))].some(p => existsSync(p));
  if (hasImsg) all.push(...upstream('./messages').messagesTools);
  const handlers = Object.fromEntries(all.map(tool => [tool.name, tool.handler]));
  for (const [name, operation] of [['list-events', 'events'], ['list-calendars', 'calendars'], ['list-reminder-lists', 'reminders-lists'], ['list-reminders', 'reminders'], ['search-reminders', 'search-reminders']]) {
    handlers[name] = async args => new Promise((resolve, reject) => {
      const argv = operation === 'events' ? [operation, String(args.count), String(args.daysAhead)]
        : operation === 'reminders' ? [operation, String(args.count), String(args.includeCompleted), ...(args.listName === undefined ? [] : [args.listName])]
        : operation === 'search-reminders' ? [operation, String(args.count), args.query] : [operation];
      execFile(join(import.meta.dirname, 'calendar-reader'), argv, { env, timeout: 25000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(Error('Native Apple read failed; check app Full Access on the daemon host'));
        try { resolve(JSON.parse(stdout)); } catch { reject(Error('Invalid native Apple result')); }
      });
    });
  }
  handlers['list-notes'] = async args => JSON.parse(await run(notesListScript(args), true));
  // Mail's dictionary exposes messages on mailboxes, not on Application('Mail').
  handlers['read-email'] = async args => {
    const message = JSON.parse(await run(mailReadScript(args), true));
    if (!message) throw Error('Message unavailable in selected mailbox');
    return message;
  };
  return handlers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv[2];
  const require = createRequire(join(root, 'package.json'));
  const { StdioServerTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href);
  const server = await createAppleServer(root, localHandlers(root));
  await server.connect(new StdioServerTransport());
}
