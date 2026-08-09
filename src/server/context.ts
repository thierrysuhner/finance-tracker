import { getSqlite, getJsonSetting, getSetting, SETTING_KEYS } from "@/db";
import {
  type CategorizeContext, type MemoryEntry, DEFAULT_REVIEW_THRESHOLD, memoryKey,
} from "@/core/categorize/engine";
import { merchantKey, brandKey } from "@/core/parsers/party";

/**
 * Baut den Kontext für die Kategorisierung aus Datenbank und Einstellungen.
 *
 * Hier fliessen die personenbezogenen Angaben zusammen, die bewusst nicht im
 * Code stehen: die eigenen Konten und alles, was die App über Händler gelernt
 * hat.
 */
export function ladeKontext(): CategorizeContext {
  const db = getSqlite();

  const rows = db
    .prepare(
      "SELECT key, category_slug, treatment, confirmations, manual, typical_amount " +
        "FROM merchant_memory",
    )
    .all() as Array<{
    key: string;
    category_slug: string;
    treatment: string | null;
    confirmations: number;
    manual: number;
    typical_amount: number | null;
  }>;

  const memory = new Map<string, MemoryEntry>(
    rows.map((r) => [
      r.key,
      {
        categorySlug: r.category_slug,
        treatment: (r.treatment as MemoryEntry["treatment"]) ?? undefined,
        confirmations: r.confirmations,
        manual: r.manual === 1,
        typicalAmount: r.typical_amount ?? undefined,
      },
    ]),
  );

  const ownNames = getJsonSetting<string[]>(SETTING_KEYS.ownNames, []);
  const ownIbans = getJsonSetting<string[]>(SETTING_KEYS.ownIbans, []);
  const threshold = Number(getSetting(SETTING_KEYS.reviewThreshold));

  return {
    memory,
    ownNameKeys: ownNames.map(merchantKey).filter(Boolean),
    ownIbans: ownIbans.map((i) => i.replace(/\s/g, "").toUpperCase()),
    reviewThreshold: Number.isFinite(threshold) && threshold > 0
      ? threshold
      : DEFAULT_REVIEW_THRESHOLD,
  };
}

/**
 * Schreibt eine bestätigte Zuordnung ins Gedächtnis.
 *
 * Wird bei jeder Bestätigung im UI aufgerufen. Der Marken-Eintrag entsteht
 * nur bei manueller Zuordnung — sonst würde eine einzelne Coop-Filiale
 * ungewollt alle anderen mitbestimmen.
 */
export function merkeZuordnung(
  counterparty: string,
  categorySlug: string,
  opts: { treatment?: string; typicalAmount?: number; auchMarke?: boolean } = {},
): void {
  const db = getSqlite();
  const jetzt = new Date().toISOString();
  const exakt = merchantKey(counterparty);
  if (!exakt) return;

  const upsert = db.prepare(`
    INSERT INTO merchant_memory (key, category_slug, treatment, confirmations, manual, typical_amount, updated_at)
    VALUES (?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      category_slug  = excluded.category_slug,
      treatment      = excluded.treatment,
      confirmations  = merchant_memory.confirmations + 1,
      manual         = 1,
      typical_amount = excluded.typical_amount,
      updated_at     = excluded.updated_at
  `);

  upsert.run(
    memoryKey("exakt", exakt),
    categorySlug,
    opts.treatment ?? null,
    opts.typicalAmount ?? null,
    jetzt,
  );

  if (opts.auchMarke) {
    const marke = brandKey(counterparty);
    if (marke && marke !== exakt) {
      upsert.run(memoryKey("marke", marke), categorySlug, opts.treatment ?? null, null, jetzt);
    }
  }
}

export function vergissZuordnung(counterparty: string): void {
  const db = getSqlite();
  db.prepare("DELETE FROM merchant_memory WHERE key = ?").run(
    memoryKey("exakt", merchantKey(counterparty)),
  );
}
