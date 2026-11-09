import {
  ComputerError,
  type Computer,
  type ComputerCapabilities,
  type ComputerStatus,
} from "../computer.js";
import type { Ledger } from "../ledger.js";

/**
 * The one `Computer` the rest of the daemon sees. It forwards every call to the ACTIVE backend (cua, browserbase,
 * docker, ssh) chosen by the `computer.backend` setting, so the tools, the gate, takeover and the desk never know which.
 *
 * - Backends are created lazily; one that is not configured (no key, no Docker, no host) is INERT: lifecycle and action
 *   calls fail with a clear reason and nothing is ever started or contacted.
 * - A switch happens only between calls, and never while the current backend is busy or a human holds control, so a
 *   running action is never cut off and a person never loses their session.
 */

export type BackendKind = "cua" | "browserbase" | "docker" | "ssh";

export interface BackendAvailability {
  backend: BackendKind;
  /** null = ready to use; otherwise why it cannot start (never a secret). */
  reason: string | null;
}

export interface ComputerRouter extends Computer {
  /** Inspect the current backend without applying a pending switch or releasing a session. */
  inspect(): Promise<ComputerStatus & { capabilities: ComputerCapabilities }>;
  activeBackend(): BackendKind;
  availability(): BackendAvailability[];
  /** Releases every hosted (billed) session this router created; rejects if release is unconfirmed. */
  releaseHosted(): Promise<void>;
}

export interface RouterDeps {
  /** Builds a backend. Only called when its `unavailable()` is null. */
  create: Record<BackendKind, () => Computer>;
  /** null = configured; otherwise a short reason. */
  unavailable: Record<BackendKind, () => string | null>;
  /** The wanted backend (the `computer.backend` setting). */
  wanted: () => BackendKind;
  /** Declared shell support, available before a backend is instantiated. */
  shell?: Partial<Record<BackendKind, boolean>>;
  /** True while a human holds control: no switching then. */
  switchBlocked?: () => boolean;
  ledger?: Ledger;
}

const ORDER: BackendKind[] = ["cua", "browserbase", "docker", "ssh"];

export function createComputerRouter(deps: RouterDeps): ComputerRouter {
  const instances = new Map<BackendKind, Computer>();
  let current: BackendKind = deps.wanted();
  let guard: Parameters<Computer["setInputGuard"]>[0];

  const instance = (kind: BackendKind): Computer => {
    const reason = deps.unavailable[kind]();
    if (reason !== null) throw new ComputerError("failed", reason);
    let c = instances.get(kind);
    if (!c) {
      c = deps.create[kind]();
      c.setInputGuard(guard);
      instances.set(kind, c);
    }
    return c;
  };

  const anyBusy = () => [...instances.values()].some((c) => c.busy());

  /** Applies a pending backend change when it is safe. Returns the backend to use for this call. */
  function select(): BackendKind {
    const wanted = deps.wanted();
    if (wanted === current) return current;
    const active = instances.get(current);
    if (active?.busy() || deps.switchBlocked?.() === true) return current;
    const from = current;
    current = wanted;
    // A hosted session keeps running (and billing) after we stop using it: release it when we switch away.
    if (active?.capabilities().hosted === true) void active.stop().catch(() => undefined);
    try {
      deps.ledger?.append("_system", "user", "config", { action: "computer_backend_switched", from, to: wanted });
    } catch {
      // auditing must never decide whether the switch happens
    }
    return current;
  }

  const active = (): Computer => instance(select());

  /** What status() reports for a backend that cannot start: honest and secret-free. */
  const inertStatus = (kind: BackendKind, reason: string): ComputerStatus => ({
    backend: kind,
    name: kind,
    exists: false,
    state: "absent",
    status: null,
    image: null,
    kind: null,
    runtime: null,
    busy: false,
    lastError: reason,
  });

  const unavailableCaps: ComputerCapabilities = { shell: false, view: "none" };

  return {
    async inspect() {
      const kind = current;
      const reason = deps.unavailable[kind]();
      if (reason !== null) return { ...inertStatus(kind, reason), capabilities: unavailableCaps };
      const computer = instance(kind);
      return { ...await computer.status(), capabilities: computer.capabilities() };
    },
    peek() {
      const observation = instances.get(current)?.peek?.();
      const wanted = deps.wanted();
      return {
        backend: current,
        requestedBackend: wanted === current ? null : wanted,
        configured: deps.unavailable[current]() === null,
        shell: observation?.shell ?? deps.shell?.[current] ?? null,
        state: observation?.state ?? "not_observed",
        observedAt: observation?.observedAt ?? null,
        busy: anyBusy(),
        inputBlocked: typeof guard?.() === "string",
      };
    },
    get name() {
      return instances.get(current)?.name ?? current;
    },
    busy: anyBusy,
    activeBackend: () => select(),
    availability: () => ORDER.map((backend) => ({ backend, reason: deps.unavailable[backend]() })),
    async releaseHosted() {
      const results = await Promise.allSettled([...instances.values()].filter((c) => c.capabilities().hosted === true).map((c) => c.stop()));
      if (results.some(result => result.status === "rejected" || !["absent", "stopped"].includes(result.value.state))) throw new ComputerError("failed", "hosted release unconfirmed");
    },

    setInputGuard(fn) {
      guard = fn;
      for (const c of instances.values()) c.setInputGuard(fn);
    },

    capabilities() {
      const kind = select();
      return deps.unavailable[kind]() === null ? instance(kind).capabilities() : unavailableCaps;
    },

    withLock: (fn) => active().withLock(fn),

    async status() {
      const kind = select();
      const reason = deps.unavailable[kind]();
      return reason === null ? instance(kind).status() : inertStatus(kind, reason);
    },

    start: async () => active().start(),
    stop: async () => active().stop(),
    destroy: async () => active().destroy(),
    screenshot: async () => active().screenshot(),
    act: async (args,guard) => active().act(args,guard),
    shell: async (command, timeoutSec,guard) => active().shell(command, timeoutSec,guard),
    viewLink: async () => active().viewLink(),
  };
}
