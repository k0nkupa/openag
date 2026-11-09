// Example App tool. The daemon runs this as a child process: the model's (already validated) arguments arrive on stdin as
// one JSON object, and the result is whatever JSON this prints on stdout. HOME is this app's private data folder.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tool = process.argv[2];
let input = "";
for await (const chunk of process.stdin) input += chunk;
const args = input ? JSON.parse(input) : {};

if (tool === "time") {
  console.log(JSON.stringify({ iso: new Date().toISOString(), local: new Date().toString() }));
} else if (tool === "note") {
  const file = join(process.env.HOME, "notes.txt");
  appendFileSync(file, `${String(args.text).replace(/[\r\n]+/g, " ")}\n`);
  const count = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
  console.log(JSON.stringify({ saved: true, notes: count }));
} else {
  console.error("unknown tool");
  process.exit(2);
}
