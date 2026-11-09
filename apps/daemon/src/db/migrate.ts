import type { Database } from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function migrate(db: Database, dir: string): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_version")
      .all()
      .map((r) => (r as { version: number }).version),
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = parseInt(file, 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const rebuild=sql.startsWith('-- rebuild-with-foreign-keys-off');
    const foreignKeys=db.pragma('foreign_keys',{simple:true});
    if(rebuild)db.pragma('foreign_keys = OFF');
    try { db.transaction(() => {
      db.exec(sql);
      if(rebuild&&(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Migration would break foreign-key links');
      db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)").run(
        version,
        file,
        Date.now(),
      );
    })(); } finally { if(rebuild)db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`); }
  }
}
