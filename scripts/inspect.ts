/**
 * Entwicklerwerkzeug: zeigt an, was die Parser aus den Dateien in data/eingang
 * tatsächlich herauslesen. Kein Teil der App.
 *
 *   npx tsx scripts/inspect.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseCamt053 } from "../src/core/parsers/camt053.js";
import { parseSwisscardCsv } from "../src/core/parsers/swisscard.js";
import { formatRappen, sum } from "../src/core/money.js";
import { brandKey } from "../src/core/parsers/party.js";

const EINGANG = path.resolve(process.cwd(), "data/eingang");
const files = fs.existsSync(EINGANG) ? fs.readdirSync(EINGANG) : [];

for (const f of files.filter((f) => f.endsWith(".xml"))) {
  const stmts = parseCamt053(fs.readFileSync(path.join(EINGANG, f), "utf-8"));
  for (const s of stmts) {
    console.log(`\n=== ${f} — ${s.iban} (${s.from} bis ${s.to}) ===`);
    console.log(
      `Eröffnung ${formatRappen(s.openingBalance ?? 0)} → Schluss ${formatRappen(s.closingBalance ?? 0)}`,
    );
    console.log(`${s.transactions.length} Buchungen`);
    if (s.warnings.length) console.log("Warnungen:", s.warnings);

    const ohneName = s.transactions.filter((t) => !t.counterparty);
    console.log(`\nOhne erkannte Gegenpartei: ${ohneName.length}`);
    for (const t of ohneName.slice(0, 10)) {
      console.log(`   ${t.bookingDate} ${formatRappen(t.amount, { sign: true }).padStart(11)}  "${t.rawText.replace(/\n/g, " ⏎ ").slice(0, 70)}"`);
    }

    // Wie gut fasst der Marken-Schlüssel zusammen?
    const marken = new Map<string, { n: number; total: number; beispiel: string }>();
    for (const t of s.transactions) {
      if (!t.counterparty) continue;
      const k = brandKey(t.counterparty);
      const cur = marken.get(k) ?? { n: 0, total: 0, beispiel: t.counterparty };
      cur.n++;
      cur.total += t.amount;
      marken.set(k, cur);
    }
    console.log(`\nTop-Marken (${marken.size} verschiedene):`);
    [...marken.entries()]
      .sort((a, b) => a[1].total - b[1].total)
      .slice(0, 18)
      .forEach(([k, v]) =>
        console.log(`   ${String(v.n).padStart(3)}x ${formatRappen(v.total, { sign: true }).padStart(12)}  ${k.padEnd(24)} (z.B. "${v.beispiel}")`),
      );
  }
}

for (const f of files.filter((f) => f.endsWith(".csv"))) {
  const imp = parseSwisscardCsv(fs.readFileSync(path.join(EINGANG, f), "utf-8"));
  console.log(`\n\n=== ${f} ===`);
  console.log(`${imp.transactions.length} Kartenbuchungen, ${imp.settlements.length} Ausgleichszahlungen`);
  console.log(`Kartenausgaben netto: ${formatRappen(sum(imp.transactions.map((t) => t.amount)), { sign: true })}`);
  console.log(`Ausgleich (= Sammelbuchungen im Bankauszug): ${formatRappen(sum(imp.settlements.map((t) => t.amount)), { sign: true })}`);
  if (imp.warnings.length) console.log("Warnungen:", imp.warnings);

  const kat = new Map<string, number>();
  for (const t of imp.transactions) {
    kat.set(t.issuerCategory ?? "—", (kat.get(t.issuerCategory ?? "—") ?? 0) + t.amount);
  }
  console.log("\nSwisscard-Kategorien:");
  [...kat.entries()].sort((a, b) => a[1] - b[1]).forEach(([k, v]) =>
    console.log(`   ${formatRappen(v, { sign: true }).padStart(12)}  ${k}`),
  );
  console.log("\nBeispielbuchungen:");
  for (const t of imp.transactions.slice(0, 6)) {
    console.log(`   ${t.bookingDate} ${formatRappen(t.amount, { sign: true }).padStart(10)}  ${(t.counterparty ?? "?").padEnd(28)} ${t.issuerCategory ?? ""} ${t.fxCurrency ? `[${t.fxCurrency} ${formatRappen(t.fxAmount ?? 0)}]` : ""}`);
  }
}
