import { defineConfig } from "vitest/config";

// Several suites spawn real child processes (fake CLIs, git, MCP stdio servers). On a busy machine the default 5 s
// budget makes them flaky, so give them room; a hung test still fails, just later.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
