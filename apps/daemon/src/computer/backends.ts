import { ComputerError, createComputer, type Computer } from "../computer.js";
import type { Ledger } from "../ledger.js";
import { createBrowserbaseDriver } from "./browserbase.js";
import { createDockerDriver, dockerAvailability } from "./docker.js";
import { createDriverComputer } from "./driver.js";
import { createSshDriver, sshAvailability, sshConfigFromEnv } from "./ssh.js";
import { type BackendKind, type ComputerRouter, createComputerRouter } from "./router.js";

/**
 * Wires the computer backends from the environment. Credentials come ONLY from the environment (never the DB, the
 * desk or a request), so they cannot be read back or changed over HTTP. A backend without its configuration is inert:
 * it is never created and never contacts anything.
 */

export interface BackendsOptions {
  dataDir: string;
  ledger?: Ledger;
  /** The `computer.backend` setting. */
  wanted: () => BackendKind;
  /** True while a human holds control. */
  switchBlocked?: () => boolean;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

const API_KEY_RE = /^[A-Za-z0-9_-]{8,200}$/;
const PROJECT_RE = /^[A-Za-z0-9_-]{6,80}$/;
const DOCKER_NAME_RE = /^[a-z][a-z0-9_.-]{0,62}$/;
const DOCKER_IMAGE_RE = /^[a-z0-9][a-z0-9._/:@-]{0,200}$/;

export function createComputerBackends(opts: BackendsOptions): ComputerRouter {
  const env = opts.env ?? process.env;

  const browserbaseReason = (): string | null => {
    const key = env.BROWSERBASE_API_KEY;
    if (!key) return "BROWSERBASE_API_KEY is not set";
    if (!API_KEY_RE.test(key)) return "BROWSERBASE_API_KEY is not a valid key";
    const project = env.BROWSERBASE_PROJECT_ID;
    if (project !== undefined && project !== "" && !PROJECT_RE.test(project)) return "BROWSERBASE_PROJECT_ID is not valid";
    return null;
  };

  const dockerReason = (): string | null => {
    const missing = dockerAvailability(env);
    if (missing !== null) return missing;
    if (env.OPENAG_DOCKER_NAME !== undefined && env.OPENAG_DOCKER_NAME !== "" && !DOCKER_NAME_RE.test(env.OPENAG_DOCKER_NAME)) return "OPENAG_DOCKER_NAME is not valid";
    if (env.OPENAG_DOCKER_IMAGE !== undefined && env.OPENAG_DOCKER_IMAGE !== "" && !DOCKER_IMAGE_RE.test(env.OPENAG_DOCKER_IMAGE)) return "OPENAG_DOCKER_IMAGE is not valid";
    return null;
  };

  const sshReason = (): string | null => {
    const missing = sshAvailability(env);
    if (missing !== null) return missing;
    const cfg = sshConfigFromEnv(env);
    return "reason" in cfg ? cfg.reason : null;
  };

  const create: Record<BackendKind, () => Computer> = {
    cua: () => createComputer({ dataDir: opts.dataDir, ledger: opts.ledger }),
    browserbase: () =>
      createDriverComputer(
        createBrowserbaseDriver({
          apiKey: env.BROWSERBASE_API_KEY ?? "",
          projectId: env.BROWSERBASE_PROJECT_ID || undefined,
          fetch: opts.fetch,
        }),
        { dataDir: opts.dataDir, ledger: opts.ledger },
      ),
    docker: () =>
      createDriverComputer(createDockerDriver({ name: env.OPENAG_DOCKER_NAME || undefined, image: env.OPENAG_DOCKER_IMAGE || undefined, env }), {
        dataDir: opts.dataDir,
        ledger: opts.ledger,
      }),
    ssh: () => {
      const cfg = sshConfigFromEnv(env);
      if ("reason" in cfg) throw new ComputerError("failed", cfg.reason);
      return createDriverComputer(createSshDriver({ config: cfg.config, env }), { dataDir: opts.dataDir, ledger: opts.ledger });
    },
  };

  return createComputerRouter({
    create,
    unavailable: {
      cua: () => null,
      browserbase: browserbaseReason,
      docker: dockerReason,
      ssh: sshReason,
    },
    wanted: opts.wanted,
    shell: { cua: true, browserbase: false, docker: true, ssh: true },
    switchBlocked: opts.switchBlocked,
    ledger: opts.ledger,
  });
}
