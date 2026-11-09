import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveOwnerCredential } from "./owner-credential.js";
import { pathToFileURL } from "node:url";
import { type Db, openDb, resolveDataDir } from "./db/index.js";
import { addMember, createBot, createRoom, getBot, getRoom, mergeBotConfig } from "./rooms.js";

export function seed(db: Db): void {
  if (!getBot(db, "boss")) {
    // ACP by default (runs on the machine's Claude login, no API key needed); an explicit model opts into the API runtime.
    const apiModel = process.env.OPENAG_BOSS_MODEL;
    createBot(db, apiModel ? { id: "boss", runtime: "api", model: apiModel } : { id: "boss", runtime: "acp", model: "claude-code" });
  }
  if (!getBot(db, "coder")) {
    createBot(db, { id: "coder", runtime: "acp", model: "claude-code" });
  }
  if (!getBot(db, "researcher")) {
    createBot(db, { id: "researcher", runtime: "acp", model: "codex" });
  }
  if (!getBot(db, "codex")) {
    createBot(db, { id: "codex", runtime: "acp", model: "codex" });
  }
  // Optional local bot: OPENAG_SEED_OLLAMA_MODEL=<name of a model you pulled with `ollama pull`> adds bot "local".
  const localModel = process.env.OPENAG_SEED_OLLAMA_MODEL;
  if (localModel && !getBot(db, "local") && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/.test(localModel)) {
    createBot(db, { id: "local", runtime: "api", model: `ollama/${localModel}` });
  }
  if (!getRoom(db, "main")) createRoom(db, { id: "main", leadBotId: "boss" });
  for (const id of ["boss", "coder", "researcher", "codex", ...(getBot(db, "local") ? ["local"] : [])]) addMember(db, "main", id);

  mergeBotConfig(db, "boss", {
    instructions: "You are Boss, the lead of this room. Answer simply yourself, or hand work to a specialist by @mention.",
    description: "Lead of the room. Answers simply or hands work to specialists.",
  });
  mergeBotConfig(db, "coder", {
    instructions: "You are Coder, a specialist in this room. Do the file and code work you are asked for, then reply with a short summary.",
    description: "Writes and edits files in its work directory. Asks before acting.",
  });
  mergeBotConfig(db, "codex", {
    adapter: "codex",
    instructions: "You are Codex, a specialist in this room. Do the code work you are asked for, then reply with a short summary.",
    description: "Coding specialist running on Codex. Asks before acting.",
  });
  mergeBotConfig(db, "researcher", {
    adapter: "codex",
    instructions: "You research questions using search and reading tools only and answer concisely. Follow the selected daemon permission mode; these instructions grant no additional authority.",
    description: "Researches questions and follows the selected session permission mode.",
  });

  // Permission sessions copy the installation default; model instructions grant no authority.

}

// Only the CLI run seeds; importing seed() (tests) has no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = resolveDataDir();
  if (!existsSync(join(dataDir, "openag.db"))) resolveOwnerCredential(dataDir, process.env.OPENAG_TOKEN);
  const db = openDb();
  seed(db);
  console.log("seeded room main with bots boss, coder, researcher and codex");
  db.close();
}
