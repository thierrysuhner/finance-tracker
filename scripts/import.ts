/**
 * Import über die Kommandozeile — nützlich für die Ersteinrichtung und zum
 * Prüfen, ohne die Weboberfläche zu starten.
 *
 *   npx tsx scripts/import.ts data/eingang/*.xml data/eingang/*.csv
 */
import fs from "node:fs";
import path from "node:path";
import { importiere, protokolliere, verknuepfeKontoAufladungen, pruefeDeckung } from "../src/server/import";
import { getDb, setJsonSetting, SETTING_KEYS } from "../src/db/index";
import { formatRappen } from "../src/core/money";

const dateien = process.argv.slice(2);
if (dateien.length === 0) {
  console.error("Aufruf: npx tsx scripts/import.ts <datei> [<datei> ...]");
  process.exit(1);
}

// Beim ersten Lauf die eigenen Konten hinterlegen, damit Überträge aufs eigene
// Konto nicht als Ausgabe zählen. Später geschieht das in den Einstellungen.
async function setzeAusUmgebung(variable: string, schluessel: string, label: string) {
  const wert = process.env[variable];
  if (!wert) return;
  const liste = wert.split(";").map((s) => s.trim()).filter(Boolean);
  await setJsonSetting(schluessel, liste);
  console.log(`${label}: ${liste.join(", ")}`);
}

async function main() {
await setzeAusUmgebung("OWN_NAMES", SETTING_KEYS.ownNames, "Eigene Namen");
await setzeAusUmgebung("OWN_IBANS", SETTING_KEYS.ownIbans, "Eigene Konten");
await setzeAusUmgebung("INVESTMENT_IBANS", SETTING_KEYS.investmentIbans, "Anlagekonten");
await setzeAusUmgebung("LINKED_IBANS", SETTING_KEYS.linkedIbans, "Verknüpfte Konten");

for (const datei of dateien) {
  if (!fs.existsSync(datei)) {
    console.error(`Nicht gefunden: ${datei}`);
    continue;
  }
  const inhalt = fs.readFileSync(datei, "utf-8");
  const e = await importiere(path.basename(datei), inhalt);
  await protokolliere(e);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${e.dateiname}  [${e.quelle}]`);
  console.log(`${"─".repeat(60)}`);
  if (e.zeitraum) console.log(`Zeitraum:  ${e.zeitraum.von} bis ${e.zeitraum.bis}`);
  console.log(`Neu:       ${e.neu}`);
  console.log(`Bekannt:   ${e.bekannt} (übersprungen)`);
  console.log(`Offen:     ${e.offen} brauchen eine Zuordnung`);
  if (e.saldoprobe) {
    console.log(`${e.saldoprobe.ok ? "✓" : "✗"} ${e.saldoprobe.text}`);
  }
  if (e.warnungen.length) {
    console.log(`\nHinweise (${e.warnungen.length}):`);
    e.warnungen.slice(0, 5).forEach((w) => console.log(`   • ${w}`));
  }
  if (e.beispiele.length) {
    console.log("\nBeispiele:");
    e.beispiele.forEach((b) =>
      console.log(`   ${b.datum}  ${b.betrag.padStart(11)}  ${b.gegenpartei.slice(0, 28).padEnd(29)} ${b.kategorie ?? "→ offen"}`),
    );
  }
}

// Nachbereitung: Aufladungen verknüpfen und Deckung prüfen.
const verknuepft = await verknuepfeKontoAufladungen();
if (verknuepft > 0) {
  console.log(`\n${verknuepft} Aufladungen des verknüpften Kontos erkannt und neutral gestellt.`);
}

const luecken = await pruefeDeckung();
if (luecken.length > 0) {
  console.log("\n⚠️  DECKUNGSLÜCKE");
  for (const l of luecken) {
    console.log(
      `   ${l.jahr}: ${formatRappen(l.aufgeladen)} überwiesen, aber nur ` +
      `${formatRappen(l.erfassteAusgaben)} an Ausgaben erfasst — ` +
      `${formatRappen(l.luecke)} fehlen.`,
    );
  }
  console.log("   Fehlt für diesen Zeitraum der Auszug des verknüpften Kontos?");
}

// Gesamtübersicht
const db = await getDb();
const summe = await db.get<any>(
    `SELECT COUNT(*) n,
            SUM(CASE WHEN amount < 0 AND treatment = 'normal' THEN amount ELSE 0 END) ausgaben,
            SUM(CASE WHEN amount > 0 AND treatment = 'normal' THEN amount ELSE 0 END) einnahmen,
            SUM(CASE WHEN treatment = 'neutral' THEN 1 ELSE 0 END) neutral,
            SUM(CASE WHEN category_slug IS NULL OR confidence < 0.75 THEN 1 ELSE 0 END) offen
     FROM transactions`,
  );

console.log(`\n${"═".repeat(60)}`);
console.log("BESTAND IN DER DATENBANK");
console.log("═".repeat(60));
console.log(`Buchungen gesamt:  ${summe.n}`);
console.log(`Ausgaben:          ${formatRappen(summe.ausgaben ?? 0, { sign: true })}`);
console.log(`Einnahmen:         ${formatRappen(summe.einnahmen ?? 0, { sign: true })}`);
console.log(`Neutral gestellt:  ${summe.neutral} (Eigenüberträge, Kartenausgleich)`);
console.log(`Offene Zuordnung:  ${summe.offen}`);
console.log("═".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
