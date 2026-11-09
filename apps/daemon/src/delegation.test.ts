import { describe, expect, test } from "vitest";
import { MAX_FANOUT, MAX_HOPS, parseDelegations } from "./delegation.js";

const members = ["boss", "coder", "researcher"];
const parse = (text: string) => parseDelegations(text, members, "boss");

describe("parseDelegations", () => {
  test.each<[string, string, { target: string; task: string }[]]>([
    ["simple line", "@coder write hi", [{ target: "coder", task: "write hi" }]],
    ["colon and comma after name", "@coder: write hi\n@researcher, find x", [
      { target: "coder", task: "write hi" },
      { target: "researcher", task: "find x" },
    ]],
    ["indented line", "   @coder do it", [{ target: "coder", task: "do it" }]],
    ["continuation lines join the task", "@coder do it\nstep two\n\nstep three", [
      { target: "coder", task: "do it\nstep two\n\nstep three" },
    ]],
    ["text before a delegation is not part of it", "intro\n@coder do it", [{ target: "coder", task: "do it" }]],
    ["case-insensitive, returns real id", "@CODER hi", [{ target: "coder", task: "hi" }]],
    ["self mention ignored", "@boss talk to yourself", []],
    ["@everyone ignored", "@everyone hello all", []],
    ["unknown name ignored", "@ghost do it", []],
    ["empty task skipped", "@coder\n@researcher   ", []],
    ["mid-line mention ignored", "ask @coder later", []],
    ["email address ignored", "mail a@coder.com", []],
    ["email at line start ignored", "@coder.com is the address", []],
    ["@name followed by text that is not a delimiter ignored", "@coderx do it", []],
    ["first mention of a target wins", "@coder one\n@coder two", [{ target: "coder", task: "one" }]],
    ["no delegations", "just an answer", []],
  ])("%s", (_name, text, expected) => {
    expect(parse(text)).toEqual(expected);
  });

  test("a non-delegation line closes the previous task only at a delegation line", () => {
    expect(parse("@coder one\nmore context\n@ghost x\nignored line")).toEqual([{ target: "coder", task: "one\nmore context" }]);
  });

  test(`returns at most MAX_FANOUT (${MAX_FANOUT}) delegations`, () => {
    const text = "@coder a\n@researcher b\n@extra c\n@more d\n@coder e";
    expect(parseDelegations(text, ["boss", "coder", "researcher", "extra"], "boss")).toHaveLength(MAX_FANOUT);
    expect(MAX_HOPS).toBe(3);
  });
});
