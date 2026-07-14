/** open (and migrate) the local sqlite database. */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";
import { DDL } from "./schema.js";

export type LocalDb = BetterSQLite3Database<typeof schema>;

export interface OpenedDatabase {
  db: LocalDb;
  sqlite: Database.Database;
  close(): void;
}

/** pass ":memory:" in tests. */
export const openLocalDatabase = (path: string): OpenedDatabase => {
  const sqlite = new Database(path);
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
};
