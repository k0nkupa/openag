import { expect, test } from "vitest";
import { resolveTargets } from "./addressing.js";

const room = { leadBotId: "boss", members: ["boss", "coder", "researcher"] };

const cases: [string, string, string[]][] = [
  ["single mention", "@coder make a file", ["coder"]],
  ["multiple mentions", "@coder and @researcher help", ["coder", "researcher"]],
  ["@everyone", "@everyone status?", ["boss", "coder", "researcher"]],
  ["no mention goes to lead", "what's up", ["boss"]],
  ["unknown mention ignored, falls to lead", "@nobody hi", ["boss"]],
  ["unknown plus known", "@nobody @coder hi", ["coder"]],
  ["email address does not match", "mail a@coder.com please", ["boss"]],
  ["case-insensitive, deduped", "@Coder @coder hi", ["coder"]],
  ["mention at start of line in multiline", "hello\n@researcher dig", ["researcher"]],
];

test.each(cases)("%s", (_name, text, expected) => {
  expect(resolveTargets(text, room)).toEqual(expected);
});

test("room without lead and no mention resolves to nobody", () => {
  expect(resolveTargets("hi", { leadBotId: null, members: ["coder"] })).toEqual([]);
});
