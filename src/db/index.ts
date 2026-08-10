import { createClient, type Client, type InArgs } from "@libsql/client";

/**
 * Datenbankzugriff über libSQL.
 *
 * EIN TREIBER FÜR ALLE UMGEBUNGEN. libSQL ist ein SQLite-Abkömmling und
 * versteht sowohl lokale Dateien als auch eine entfernte Datenbank bei Turso.
 * Dadurch bleibt jede SQL-Anweisung wörtlich gleich — auch die
 * SQLite-Eigenheiten julianday(), MIN(0, x) und ON CONFLICT, die bei
 * PostgreSQL alle hätten umgeschrieben werden müssen.
 *
 * Der Preis dafür: alle Zugriffe sind asynchron. Ein Netzwerktreiber kann
 * nicht anders. Genau deshalb wurde vor dieser Umstellung eine Testsuite für
 * die Abfragen geschrieben.
 *
 * Auswahl der Verbindung:
 *   TURSO_DATABASE_URL gesetzt  ->  entfernte Datenbank (Vercel)
 *   sonst DATABASE_PATH         ->  lokale Datei (Docker, eigener Server)
 *   sonst                       ->  ./data/finance.db (Entwicklung)
 */

export type Args = InArgs;

/** Was innerhalb wie ausserhalb einer Transaktion verfügbar ist. */
export interface SqlRunner {
  all<T = Record<string, any>>(sql: string, args?: Args): Promise<T[]>;
  get<T = Record<string, any>>(sql: string, args?: Args): Promise<T | undefined>;
  run(sql: string, args?: Args): Promise<{ changes: number }>;
}

export interface Datenbank extends SqlRunner {
  /**
   * Führt mehrere Schreibvorgänge gemeinsam aus. Bricht etwas ab, bleibt
   * nichts halb Geschriebenes zurück — beim Monatsimport der springende Punkt.
   */
  tx<T>(fn: (t: SqlRunner) => Promise<T>): Promise<T>;
}

function verbindung(): { url: string; authToken?: string } {
  const turso = process.env.TURSO_DATABASE_URL?.trim();
  if (turso) {
    return { url: turso, authToken: process.env.TURSO_AUTH_TOKEN?.trim() };
  }
  const pfad = process.env.DATABASE_PATH?.trim() || "./data/finance.db";
  // file:-URLs von libSQL wollen einen Pfad ohne Schema-Doppelung.
  return { url: pfad.startsWith("file:") ? pfad : `file:${pfad}` };
}

let _client: Client | null = null;
let _bereit: Promise<void> | null = null;

function client(): Client {
  if (!_client) _client = createClient(verbindung());
  return _client;
}

/** Wandelt eine libSQL-Zeile in ein schlichtes Objekt. */
function alsObjekt<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

function runnerFuer(ausfuehren: (sql: string, args?: Args) => Promise<any>): SqlRunner {
  return {
    async all<T>(sql: string, args?: Args): Promise<T[]> {
      const r = await ausfuehren(sql, args);
      return r.rows.map((row: unknown) => alsObjekt<T>(row));
    },
    async get<T>(sql: string, args?: Args): Promise<T | undefined> {
      const r = await ausfuehren(sql, args);
      return r.rows.length ? alsObjekt<T>(r.rows[0]) : undefined;
    },
    async run(sql: string, args?: Args): Promise<{ changes: number }> {
      const r = await ausfuehren(sql, args);
      return { changes: Number(r.rowsAffected ?? 0) };
    },
  };
}

export async function getDb(): Promise<Datenbank> {
  const c = client();
  if (!_bereit) _bereit = migriere(c);
  await _bereit;

  const basis = runnerFuer((sql, args) =>
    args === undefined ? c.execute(sql) : c.execute({ sql, args }),
  );

  return {
    ...basis,
    async tx<T>(fn: (t: SqlRunner) => Promise<T>): Promise<T> {
      const t = await c.transaction("write");
      try {
        const ergebnis = await fn(
          runnerFuer((sql, args) =>
            args === undefined ? t.execute(sql) : t.execute({ sql, args }),
          ),
        );
        await t.commit();
        return ergebnis;
      } catch (fehler) {
        await t.rollback();
        throw fehler;
      }
    },
  };
}

/**
 * Schema anlegen.
 *
 * Bewusst handgeschriebenes SQL statt eines Migrationswerkzeugs: bei einer
 * Datenbank ohne Mitbenutzer ist ein Ordner voller Zeitstempel-Dateien mehr
 * Verwaltung als Nutzen. Jede Anweisung ist wiederholbar.
 *
 * Erst wird geprüft, ob das Schema schon steht. Auf Vercel läuft dieser Code
 * bei jedem Kaltstart, und eine einzelne Abfrage ist billiger als ein Dutzend
 * CREATE-Anweisungen über das Netz.
 */
async function migriere(c: Client): Promise<void> {
  try {
    await c.execute("SELECT 1 FROM settings LIMIT 1");
    return;
  } catch {
    // Schema fehlt — unten anlegen.
  }

  await c.executeMultiple(`
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

/** Nur für Tests: Verbindung zurücksetzen, damit eine neue Datei greift. */
export function _reset(): void {
  _client = null;
  _bereit = null;
}

// ── Einstellungen ──────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

export const SETTING_KEYS = {
  ownNames: "own_names",
  ownIbans: "own_ibans",
  investmentIbans: "investment_ibans",
  linkedIbans: "linked_ibans",
  reviewThreshold: "review_threshold",
  passwordHash: "password_hash",
  aiProvider: "ai_provider",
  aiApiKey: "ai_api_key",
  setupDone: "setup_done",
} as const;
