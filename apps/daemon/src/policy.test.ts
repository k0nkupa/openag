import {expect,test} from "vitest";
import {classify} from "./policy.js";

test("known tools classify from the static map", () => {
  expect(classify("write_file")).toBe("act-local");
  expect(classify("read_file")).toBe("read");
});

test("hints cannot downgrade an unknown tool", () => {
  expect(classify("mystery", { toolClass: "read" })).toBe("act-external");
});

test("Codex tool names classify; codex.shell is act-external, unknown codex kinds are act-external", () => {
  expect(classify("codex.shell")).toBe("act-external");
  expect(classify("codex.edit")).toBe("act-local");
  expect(classify("codex.fetch")).toBe("browse");
  expect(classify("codex.search")).toBe("search");
  expect(classify("codex.read")).toBe("read");
  expect(classify("codex.mystery")).toBe("act-external");
});

test("prototype-chain names classify as act-external, never as inherited functions", () => {
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "__defineGetter__"]) {
    expect(classify(name)).toBe("act-external");
  }
});
