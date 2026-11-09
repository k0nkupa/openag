# Contributing to OpenAg

Thanks for looking at OpenAg. It is a self-hosted agent daemon with a web desk, and it runs agents that can act on your machine. Changes to the policy gate, approvals, redaction, authentication or ingress routes need extra care; read [SECURITY.md](SECURITY.md) first.

## Prerequisites

- Node.js 22 or later
- pnpm 10 (the repo pins `pnpm@10.28.1` in `package.json`)
- macOS is the supported platform. Linux and Windows are untested.
- Optional, for exercising real runtimes: Claude Code or Codex signed in on the host, Ollama, or a provider API key. Unit and controlled checks do not need them.

## Setup and checks

```sh
pnpm install
pnpm -r build          # builds all workspaces and packages the help handbook
pnpm -r test           # runs the Vitest suites (see the note below)
```

Run one test file or one test:

```sh
pnpm --filter daemon exec vitest run src/ledger.test.ts
pnpm --filter daemon exec vitest run -t "name of the test"
```

Behaviour checks live in `scripts/verify-*.mjs` (116 scripts). Run the ones that cover the area you changed. Two are the baseline for knowledge and capability changes:

```sh
node scripts/verify-bot-knowledge.mjs   # help handbook delivery and policy
node scripts/verify-capabilities.mjs    # capability catalogue
```

Several checks start a real daemon in a temporary data directory. Scripts that call real providers take an explicit `--real` flag; do not run those without credentials and a budget you intend to use.

**Keep the suite green.** CI runs `pnpm -r build` and `pnpm -r test` on every pull request. Update or add tests in the same change as the behaviour they cover.

## Making a change

- Keep changes focused. Record out-of-scope ideas under the Parking lot in [ROADMAP.md](ROADMAP.md) instead of building them.
- Read [AGENTS.md](AGENTS.md) for the architecture, the hard safety invariants and the repository conventions. It is written for coding agents but applies to human contributors too.
- Keep help documentation in sync. User-facing behaviour is described in `docs/help/` (a manifest plus topic Markdown files). When a feature, fix, removal or UI change alters what a user or the bot should be told, update the matching help topic in the same change, rebuild with `pnpm -r build`, and run `node scripts/verify-bot-knowledge.mjs`. Feature behaviour notes live in `docs/notes/`.
- Do not add secrets, personal data, machine-specific paths or real account details to code, tests, fixtures or docs. Use placeholders such as `example.test`.
- Do not bypass hooks (`--no-verify`) and do not commit generated output such as `dist/`.

## Commits and pull requests

- One focused commit per change.
- Use Conventional Commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Keep the subject short and imperative, for example `fix: reject unsigned webhook bodies`.
- Open pull requests as drafts unless the change is ready for review.
- In the PR description, include a summary of the change, the exact checks you ran with their results, and any checks you skipped and why.

## Reporting bugs and security issues

- Bugs and feature requests: open a GitHub issue with the version or commit, the steps to reproduce, and what you expected.
- Security issues: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Licence

OpenAg is released under the [MIT Licence](LICENSE). By contributing you agree your contribution is licensed under the same terms. Do not submit code you do not have the right to contribute, and do not vendor third-party code without its licence.
