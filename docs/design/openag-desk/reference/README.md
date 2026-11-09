# OpenAg frozen UI reference

Start with [the design handover](../README.md). This is a self-contained design reference with sample state, not the production desk. Do not import its fake state providers into `apps/desk`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open http://127.0.0.1:5191/?variant=A#/room/main. `pnpm build` runs TypeScript and Vite. There are no unit-test scripts, daemon proxies, credentials or real service actions. Reload resets sample state. Use `shasum -a 256 -c SHA256SUMS` to verify the frozen source.

The copied source and assets match the reviewed standalone prototype; dev/preview use port 5191 instead of 5190. The local workspace file keeps installation independent of the repository's app workspaces. `node_modules` and `dist` are not handover artifacts. Brand sources and licences are in `public/brands/`.
