import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/db -> server/data, and server/dist/db -> server/data.
export const DB_DIR = path.resolve(__dirname, "../../data");
export const DB_PATH = process.env.DATABASE_PATH ?? path.join(DB_DIR, "id-ladder.db");
export const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export function openDatabase(dbPath: string = DB_PATH): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
