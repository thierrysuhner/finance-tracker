import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

/**
 * Datenbankzugriff.
 *
 * Die Datei liegt unter data/ und ist per .gitignore ausgeschlossen. Der Pfad
 * lässt sich über DATABASE_PATH umstellen — im Container zeigt er auf ein
 * Volume, damit die Daten einen Neustart des Containers überleben.
 */

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), "data/finance.db");

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getSqlite(): Database.Database {
  if (_sqlite) return _sqlite;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);

  // WAL erlaubt Lesen während geschrieben wird — beim Import spürbar.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Ohne diese Einstellung riskiert man bei einem Stromausfall mitten im
  // Import einen inkonsistenten Stand.
  sqlite.pragma("synchronous = NORMAL");

  migrate(sqlite);
  _sqlite = sqlite;
  return sqlite;
}

export function getDb() {
  if (!_db) _db = drizzle(getSqlite(), { schema });
  return _db;
}

/**
 * Schema anlegen und fortschreiben.
 *
 * Bewusst als handgeschriebenes SQL statt Migrations-Werkzeug: bei einer
 * einzelnen Datei ohne Mitbenutzer ist ein Migrationsordner mit Zeitstempeln
 * mehr Verwaltung als Nutzen. Jede Anweisung ist idempotent.
 */
function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id        TEXT NOT NULL,
      source             TEXT NOT NULL,
      account_ref        TEXT NOT NULL,
      card_ref           TEXT,
      booking_date       TEXT NOT NULL,
      value_date         TEXT,
      amount             INTEGER NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'CHF',
      fx_currency        TEXT,
      fx_amount          INTEGER,
      raw_text           TEXT NOT NULL DEFAULT '',
      counterparty       TEXT,
      counterparty_iban  TEXT,
      counterparty_phone TEXT,
      tx_time            TEXT,
      place              TEXT,
      issuer_category    TEXT,
      issuer_mcc         TEXT,
      bank_tx_code       TEXT,
      category_slug      TEXT,
      necessity_override TEXT,
      treatment          TEXT NOT NULL DEFAULT 'normal',
      confidence         REAL NOT NULL DEFAULT 0,
      stage              TEXT,
      reason             TEXT,
      reviewed           INTEGER NOT NULL DEFAULT 0,
      note               TEXT,
      offset_of          INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_source_external
      ON transactions(source, external_id);
    CREATE INDEX IF NOT EXISTS ix_booking_date  ON transactions(booking_date);
    CREATE INDEX IF NOT EXISTS ix_category      ON transactions(category_slug);
    CREATE INDEX IF NOT EXISTS ix_counterparty  ON transactions(counterparty);
    CREATE INDEX IF NOT EXISTS ix_offset_of     ON transactions(offset_of);

    CREATE TABLE IF NOT EXISTS merchant_memory (
      key            TEXT PRIMARY KEY,
      category_slug  TEXT NOT NULL,
      treatment      TEXT,
      confirmations  INTEGER NOT NULL DEFAULT 1,
      manual         INTEGER NOT NULL DEFAULT 0,
      typical_amount INTEGER,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category_slug TEXT NOT NULL,
      month         TEXT,
      amount        INTEGER NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_budget
      ON budgets(category_slug, IFNULL(month, ''));

    CREATE TABLE IF NOT EXISTS recurring (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_key  TEXT NOT NULL,
      label         TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      interval_days INTEGER NOT NULL,
      last_seen     TEXT NOT NULL,
      next_expected TEXT,
      confirmed     INTEGER NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS imports (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      filename        TEXT NOT NULL,
      source          TEXT NOT NULL,
      imported_at     TEXT NOT NULL,
      period_from     TEXT,
      period_to       TEXT,
      new_count       INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      warnings        TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ── Einstellungen ──────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getSqlite()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getSqlite()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getJsonSetting<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJsonSetting(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}

export const SETTING_KEYS = {
  ownNames: "own_names",
  ownIbans: "own_ibans",
  reviewThreshold: "review_threshold",
  passwordHash: "password_hash",
  aiProvider: "ai_provider",
  aiApiKey: "ai_api_key",
  setupDone: "setup_done",
} as const;

export { schema };
