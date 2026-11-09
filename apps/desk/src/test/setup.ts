import { cleanup, configure } from "@testing-library/react";
import { beforeEach, afterEach, vi } from "vitest";

// Async queries (findBy*, waitFor) poll for 1s by default, which is too tight when other suites share the CPU.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom lacks these browser APIs, which cmdk-based and popup components need.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

// jsdom does not implement media queries. Individual responsive tests can override this.
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
});
