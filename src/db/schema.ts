import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";

/**
 * Datenmodell.
 *
 * SQLite, weil die Datenbank damit eine einzige Datei ist: Backup heisst
 * kopieren, Umzug auf einen anderen Server heisst kopieren. Bei einem
 * Einzelnutzer ist alles andere unnötiger Betriebsaufwand.
 */

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    // ── Herkunft ─────────────────────────────────────────────────────────
    /** Referenz aus der Quelldatei. Zusammen mit source eindeutig. */
    externalId: text("external_id").notNull(),
    source: text("source").notNull(), // camt053 | swisscard | manual
    accountRef: text("account_ref").notNull(),
    cardRef: text("card_ref"),

    // ── Buchung ──────────────────────────────────────────────────────────
    bookingDate: text("booking_date").notNull(), // ISO yyyy-mm-dd
    valueDate: text("value_date"),
    /** Rappen, negativ = Ausgabe. Ganzzahlig, damit Summen exakt bleiben. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("CHF"),
    fxCurrency: text("fx_currency"),
    fxAmount: integer("fx_amount"),

    // ── Beschreibung ─────────────────────────────────────────────────────
    /** Originaltext, unverändert. Wird nie überschrieben. */
    rawText: text("raw_text").notNull().default(""),
    counterparty: text("counterparty"),
    counterpartyIban: text("counterparty_iban"),
    counterpartyPhone: text("counterparty_phone"),
    txTime: text("tx_time"),
    place: text("place"),
    issuerCategory: text("issuer_category"),
    issuerMcc: text("issuer_mcc"),
    bankTxCode: text("bank_tx_code"),

    // ── Zuordnung ────────────────────────────────────────────────────────
    categorySlug: text("category_slug"),
    /**
     * Abweichende Notwendigkeitsstufe für genau diese Buchung.
     * Eine Winterjacke ist Shopping, aber wenn es die einzige ist, ist sie
     * nötig. Ohne diese Möglichkeit wäre die Einteilung zu grob.
     */
    necessityOverride: text("necessity_override"),
    treatment: text("treatment").notNull().default("normal"),
    confidence: real("confidence").notNull().default(0),
    stage: text("stage"),
    reason: text("reason"),
    /** Vom Nutzer bestätigt — schützt die Zuordnung vor Überschreiben. */
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    note: text("note"),

    // ── Verrechnung ──────────────────────────────────────────────────────
    /**
     * Verweist auf die Buchung, die durch diese hier ganz oder teilweise
     * ausgeglichen wird: TWINT-Rückzahlung eines Kollegen, Kartenretoure oder
     * zurückgezahlte Kaution.
     */
    offsetOf: integer("offset_of"),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    // Verhindert Doppelimporte, wenn dieselbe Datei zweimal eingelesen wird.
    uniqueSource: unique("uq_source_external").on(t.source, t.externalId),
    byDate: index("ix_booking_date").on(t.bookingDate),
    byCategory: index("ix_category").on(t.categorySlug),
    byCounterparty: index("ix_counterparty").on(t.counterparty),
  }),
);

/**
 * Gelernte Händler-Zuordnungen.
 *
 * Hier landen die personenbezogenen Angaben — Vermieter, Familie, Kollegen.
 * Deshalb liegt diese Tabelle in der Datenbank und nicht als Regel im Code.
 */
export const merchantMemory = sqliteTable("merchant_memory", {
  /** "exakt:<schlüssel>" oder "marke:<schlüssel>" */
  key: text("key").primaryKey(),
  categorySlug: text("category_slug").notNull(),
  treatment: text("treatment"),
  confirmations: integer("confirmations").notNull().default(1),
  manual: integer("manual", { mode: "boolean" }).notNull().default(false),
  /** Nur gesetzt, wenn die Beträge stabil sind (Dauerauftrag). */
  typicalAmount: integer("typical_amount"),
  updatedAt: text("updated_at").notNull(),
});

export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categorySlug: text("category_slug").notNull(),
    /** "YYYY-MM" für einen bestimmten Monat, NULL als Standard für alle. */
    month: text("month"),
    /** Rappen, positiv. */
    amount: integer("amount").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({ uniqueBudget: unique("uq_budget").on(t.categorySlug, t.month) }),
);

/**
 * Erkannte wiederkehrende Posten.
 *
 * Basis für den Forecast: Miete kommt monatlich, die Semestergebühr zweimal
 * im Jahr. Ohne diese Tabelle würde eine Prognose die Semestergebühr entweder
 * jeden Monat oder nie erwarten.
 */
export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchantKey: text("merchant_key").notNull(),
  label: text("label").notNull(),
  categorySlug: text("category_slug").notNull(),
  /** Rappen, negativ für Ausgaben. */
  amount: integer("amount").notNull(),
  /** Erwarteter Abstand in Tagen: 30 monatlich, 182 halbjährlich. */
  intervalDays: integer("interval_days").notNull(),
  lastSeen: text("last_seen").notNull(),
  nextExpected: text("next_expected"),
  /** Vom Nutzer bestätigt oder nur vermutet. */
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Protokoll der Importe — macht nachvollziehbar, was wann hereinkam. */
export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  source: text("source").notNull(),
  importedAt: text("imported_at").notNull(),
  periodFrom: text("period_from"),
  periodTo: text("period_to"),
  newCount: integer("new_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  warnings: text("warnings"),
});

/** Einstellungen als Schlüssel-Wert, inklusive Passwort-Hash und eigenen IBANs. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantMemoryRow = typeof merchantMemory.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Recurring = typeof recurring.$inferSelect;
export type ImportRow = typeof imports.$inferSelect;
