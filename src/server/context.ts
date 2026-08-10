import { getDb, getJsonSetting, getSetting, SETTING_KEYS } from "@/db";
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
export async function ladeKontext(): Promise<CategorizeContext> {
  const db = await getDb();

  const rows = await db.all<{
    key: string;
    category_slug: string;
    treatment: string | null;
    confirmations: number;
    manual: number;
    typical_amount: number | null;
  }>(
    "SELECT key, category_slug, treatment, confirmations, manual, typical_amount " +
      "FROM merchant_memory",
  );

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

  const [ownNames, ownIbans, investmentIbans, schwelle] = await Promise.all([
    getJsonSetting<string[]>(SETTING_KEYS.ownNames, []),
    getJsonSetting<string[]>(SETTING_KEYS.ownIbans, []),
    getJsonSetting<string[]>(SETTING_KEYS.investmentIbans, []),
    getSetting(SETTING_KEYS.reviewThreshold),
  ]);

  const normIban = (i: string) => i.replace(/\s/g, "").toUpperCase();
  const threshold = Number(schwelle);

  return {
    memory,
    ownNameKeys: ownNames.map(merchantKey).filter(Boolean),
    ownIbans: ownIbans.map(normIban),
    investmentIbans: investmentIbans.map(normIban),
    reviewThreshold: Number.isFinite(threshold) && threshold > 0
      ? threshold
      : DEFAULT_REVIEW_THRESHOLD,
  };
}

/**
 * Schreibt eine bestätigte Zuordnung ins Gedächtnis.
 *
 * Das Merken ist der eigentliche Punkt: dieselbe Zuordnung soll kein zweites
 * Mal nötig sein. Der Marken-Eintrag entsteht nur auf ausdrücklichen Wunsch —
 * sonst würde eine einzelne Filiale ungewollt alle anderen mitbestimmen.
 */
export async function merkeZuordnung(
  counterparty: string,
  categorySlug: string,
  opts: { treatment?: string; typicalAmount?: number; auchMarke?: boolean } = {},
): Promise<void> {
  const exakt = merchantKey(counterparty);
  if (!exakt) return;

  const db = await getDb();
  const jetzt = new Date().toISOString();

  const SQL = `
    INSERT INTO merchant_memory (key, category_slug, treatment, confirmations, manual, typical_amount, updated_at)
    VALUES (?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      category_slug  = excluded.category_slug,
      treatment      = excluded.treatment,
      confirmations  = merchant_memory.confirmations + 1,
      manual         = 1,
      typical_amount = excluded.typical_amount,
      updated_at     = excluded.updated_at
  `;

  await db.run(SQL, [
    memoryKey("exakt", exakt),
    categorySlug,
    opts.treatment ?? null,
    opts.typicalAmount ?? null,
    jetzt,
  ]);

  if (opts.auchMarke) {
    const marke = brandKey(counterparty);
    if (marke && marke !== exakt) {
      await db.run(SQL, [
        memoryKey("marke", marke),
        categorySlug,
        opts.treatment ?? null,
        null,
        jetzt,
      ]);
    }
  }
}

export async function vergissZuordnung(counterparty: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM merchant_memory WHERE key = ?", [
    memoryKey("exakt", merchantKey(counterparty)),
  ]);
}
