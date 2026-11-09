# sqlite-vec load API (verified for OA-002)

Checked against npm on 2026-10-27.

- Package `sqlite-vec` 0.1.9 (latest; `alpha` tag is 0.1.10-alpha.4, not used).
- ESM: `import * as sqliteVec from "sqlite-vec"; sqliteVec.load(db)`.
  `load` calls `db.loadExtension(getLoadablePath())`. `getLoadablePath()` is also exported.
- Native binary comes from per-platform optional deps (`sqlite-vec-darwin-arm64`, `-darwin-x64`,
  `-linux-x64`, `-linux-arm64`, `-windows-x64`); host is covered by the darwin packages.
- Works with `better-sqlite3` 13.0.3 (engines node >=22) with no extra flags.
- pnpm 10 skips dependency build scripts by default, so `better-sqlite3` is listed in
  root `package.json` `pnpm.onlyBuiltDependencies`.
- `tsc` does not copy `.sql` files; the daemon `build` script copies `src/db/migrations` to `dist/db/`.
