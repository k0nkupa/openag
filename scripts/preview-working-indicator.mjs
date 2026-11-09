// Local-only preview of the real Feed. In-memory events; no daemon or provider calls.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../apps/desk/", import.meta.url));
const require = createRequire(root + "package.json");
const { createServer } = await import(require.resolve("vite"));
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Feed } from '/src/components/Feed';
import { StreamProvider } from '/src/stream';
import { Button } from '/src/components/ui/button';
import '/src/styles.css';
const transport = { state: 'open', onClose: () => () => {}, subscribe: async () => () => {} };
const bots = [{ id: 'boss', name: 'Bot' }];
const event = (id, type, actor, payload = {}) => ({ id, roomId: 'main', ts: Date.now(), type, actor, payload });
function Preview() {
  const [state, setState] = useState('working');
  const [dark, setDark] = useState(true);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const events = [event(1, 'message', 'user', { text: 'Show me the new working indicator.' }), event(2, 'turn_started', 'boss')];
  if (state === 'complete') events.push(event(3, 'turn_finished', 'boss'), event(4, 'message', 'boss', { text: 'All done. The working indicator is gone.' }));
  return <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-5 p-5">
    <header><h1>Working indicator preview</h1><p>Local fixture · shows the native Trace working state. No live bot calls.</p></header>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setState('working')}>Working</Button>
      <Button variant="outline" onClick={() => setState('approval')}>Approval wait</Button>
      <Button variant="outline" onClick={() => setState('complete')}>Complete</Button>
      <Button variant="outline" onClick={() => setDark(value => !value)}>Toggle theme</Button>
    </div>
    <p role="status">Preview state: {state}</p>
    <div className="flex h-[420px] flex-col rounded-xl border border-border bg-background">
      <StreamProvider token="local-preview" onAuthFailure={() => {}} rtcTransport={transport}>
        <Feed bots={bots} events={events} approvals={state === 'approval' ? [{ botId: 'boss', status: 'pending' }] : []} />
      </StreamProvider>
    </div>
    <p>Reduced motion stops the working spinner. Approval wait and Complete hide the working indicator.</p>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview />);
`;
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5198, strictPort: true, proxy: {} },
  plugins: [{
    name: "working-indicator-preview",
    resolveId(id) { if (id === "/__working-preview.tsx") return id; },
    load(id) { if (id === "/__working-preview.tsx") return entry; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/") return next();
        try {
          const html = await server.transformIndexHtml("/", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Working indicator preview</title></head><body><div id="root"></div><script type="module" src="/__working-preview.tsx"></script></body></html>');
          res.setHeader("Content-Type", "text/html"); res.end(html);
        } catch (error) { next(error); }
      });
    },
  }],
});
await server.listen();
console.log("Working indicator preview: http://127.0.0.1:5198/");
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
