/**
 * Misst die Trefferquote der Kategorisierung auf den echten Daten in
 * data/eingang. Zeigt, wie viel automatisch durchläuft und was nachgefragt
 * werden müsste.
 *
 *   npx tsx scripts/evaluate.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseCamt053 } from "../src/core/parsers/camt053";
import { parseSwisscardCsv } from "../src/core/parsers/swisscard";
import { categorize, emptyContext, needsReview, lerneAusHistorie } from "../src/core/categorize/engine";
import { categoryLabel, CATEGORY_BY_SLUG } from "../src/core/categorize/categories";
import { formatRappen } from "../src/core/money";
import { merchantKey } from "../src/core/parsers/party";
import type { ParsedTransaction } from "../src/core/types";

const EINGANG = path.resolve(process.cwd(), "data/eingang");
const alle: ParsedTransaction[] = [];

for (const f of fs.readdirSync(EINGANG)) {
  const p = path.join(EINGANG, f);
  if (f.endsWith(".xml")) {
    for (const s of parseCamt053(fs.readFileSync(p, "utf-8"))) alle.push(...s.transactions);
  } else if (f.endsWith(".csv")) {
    const imp = parseSwisscardCsv(fs.readFileSync(p, "utf-8"));
    alle.push(...imp.transactions, ...imp.settlements);
  }
}

// Simuliert die Ersteinrichtung: eigene Konten werden dort einmal hinterlegt.
const ctx = emptyContext({
  ownNameKeys: [merchantKey("Thierry Suhner"), merchantKey("HBL Meisterschwanden")],
});

const ergebnisse = alle.map((t) => ({ tx: t, s: categorize(t, ctx) }));

const sicher = ergebnisse.filter((r) => !needsReview(r.s, ctx.reviewThreshold));
const nachfrage = ergebnisse.filter((r) => needsReview(r.s, ctx.reviewThreshold));

console.log(`\n${"=".repeat(64)}`);
console.log(`Gesamt: ${alle.length} Buchungen`);
console.log(`Automatisch zugeordnet: ${sicher.length} (${((sicher.length / alle.length) * 100).toFixed(1)}%)`);
console.log(`Nachfrage nötig:        ${nachfrage.length} (${((nachfrage.length / alle.length) * 100).toFixed(1)}%)`);
console.log("=".repeat(64));

const proStufe = new Map<string, number>();
for (const r of ergebnisse) proStufe.set(r.s.stage, (proStufe.get(r.s.stage) ?? 0) + 1);
console.log("\nNach Stufe:");
[...proStufe.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
  console.log(`   ${String(v).padStart(4)}  ${k}`),
);

console.log("\nAusgaben nach Kategorie (nur sicher zugeordnete):");
const proKat = new Map<string, { n: number; total: number }>();
for (const r of sicher) {
  const slug = r.s.categorySlug!;
  const c = proKat.get(slug) ?? { n: 0, total: 0 };
  c.n++; c.total += r.tx.amount;
  proKat.set(slug, c);
}
[...proKat.entries()]
  .sort((a, b) => a[1].total - b[1].total)
  .forEach(([slug, v]) => {
    const def = CATEGORY_BY_SLUG.get(slug);
    console.log(
      `   ${formatRappen(v.total, { sign: true }).padStart(12)}  ${String(v.n).padStart(3)}x  ` +
      `${def?.icon ?? "  "} ${categoryLabel(slug).padEnd(30)} [${def?.necessity ?? "?"}]`,
    );
  });

console.log(`\nOffene Nachfragen (${nachfrage.length}) — die grössten zuerst:`);
nachfrage
  .sort((a, b) => a.tx.amount - b.tx.amount)
  .slice(0, 25)
  .forEach((r) =>
    console.log(
      `   ${r.tx.bookingDate} ${formatRappen(r.tx.amount, { sign: true }).padStart(11)}  ` +
      `${(r.tx.counterparty ?? "?").slice(0, 30).padEnd(31)} ${r.s.reason}`,
    ),
  );

// ── Wie viel Arbeit ist die Ersteinrichtung wirklich? ────────────────────
// Entscheidend ist nicht der Prozentsatz, sondern die Anzahl Entscheidungen.
// Mehrere Buchungen desselben Händlers kosten zusammen genau eine.
const offeneHaendler = new Map<string, { n: number; total: number; name: string }>();
for (const r of nachfrage) {
  const name = r.tx.counterparty ?? "(ohne Gegenpartei)";
  const k = merchantKey(name);
  const c = offeneHaendler.get(k) ?? { n: 0, total: 0, name };
  c.n++; c.total += r.tx.amount;
  offeneHaendler.set(k, c);
}

const mehrfach = [...offeneHaendler.values()].filter((v) => v.n > 1);
const einmalig = [...offeneHaendler.values()].filter((v) => v.n === 1);

console.log(`\n${"=".repeat(64)}`);
console.log("AUFWAND DER ERSTEINRICHTUNG");
console.log("=".repeat(64));
console.log(`${nachfrage.length} offene Buchungen verteilen sich auf ${offeneHaendler.size} Gegenparteien.`);
console.log(`   ${mehrfach.length} davon kommen mehrfach vor (eine Entscheidung deckt ${mehrfach.reduce((a, v) => a + v.n, 0)} Buchungen ab)`);
console.log(`   ${einmalig.length} sind Einzelfälle`);

// Zweiter Durchgang: die offenen Händler wurden einmal zugeordnet.
const nachEinrichtung = new Map(
  [...offeneHaendler.entries()].map(([k, v]) => [
    `exakt:${k}`,
    { categorySlug: "sonstiges", confirmations: 1, manual: true },
  ]),
);
const ctx2 = { ...ctx, memory: nachEinrichtung as typeof ctx.memory };
const sicher2 = alle.filter((t) => !needsReview(categorize(t, ctx2), ctx.reviewThreshold)).length;

console.log(
  `\nNach dieser einmaligen Einrichtung laufen ${sicher2} von ${alle.length} ` +
  `(${((sicher2 / alle.length) * 100).toFixed(1)}%) automatisch durch.`,
);

// ── Ehrliche Simulation des Monatsablaufs ───────────────────────────────
// Monat für Monat, so wie es real passieren wird: importieren, offene Fälle
// zuordnen, und im Folgemonat profitiert man vom Gelernten. Nur so zeigt sich
// der tatsächliche laufende Aufwand.
const nachMonat = new Map<string, ParsedTransaction[]>();
for (const t of alle) {
  const m = t.bookingDate.slice(0, 7);
  if (!nachMonat.has(m)) nachMonat.set(m, []);
  nachMonat.get(m)!.push(t);
}

const laufendesGedaechtnis = new Map<string, any>();
const laufenderCtx = { ...ctx, memory: laufendesGedaechtnis as typeof ctx.memory };

console.log("\nMonatlicher Aufwand im Zeitverlauf:");
console.log("   Monat     Buchungen   Rückfragen   davon neue Händler");
for (const m of [...nachMonat.keys()].sort()) {
  const txs = nachMonat.get(m)!;
  const offen = txs.filter((t) => needsReview(categorize(t, laufenderCtx), ctx.reviewThreshold));

  const neueHaendler = new Set(
    offen.filter((t) => t.counterparty).map((t) => merchantKey(t.counterparty!)),
  );

  const balken = "▮".repeat(Math.min(neueHaendler.size, 30));
  console.log(
    `   ${m}   ${String(txs.length).padStart(6)}   ${String(offen.length).padStart(9)}   ` +
    `${String(neueHaendler.size).padStart(6)}  ${balken}`,
  );

  // Der Nutzer ordnet die offenen Fälle zu — ab jetzt sind sie bekannt.
  for (const k of neueHaendler) {
    laufendesGedaechtnis.set(`exakt:${k}`, {
      categorySlug: "sonstiges", confirmations: 1, manual: true,
    });
  }
}
console.log("\nDie rechte Spalte ist der eigentliche Aufwand: so viele");
console.log("Zuordnungen musst du in dem Monat treffen.");
console.log("=".repeat(64));
