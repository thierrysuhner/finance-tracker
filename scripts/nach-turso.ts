/**
 * Überträgt eine lokale Datenbank nach Turso.
 *
 * Nötig, weil die Ersteinrichtung lokal deutlich schneller geht: Dateien
 * importieren, Zuordnungen treffen, prüfen — alles ohne Netz. Erst der
 * fertige Stand wandert dann in die Cloud.
 *
 *   TURSO_DATABASE_URL=libsql://…  TURSO_AUTH_TOKEN=…  \
 *   npx tsx scripts/nach-turso.ts data/finance.db
 *
 * Die Zieldatenbank wird vorher geleert. Das ist Absicht: ein teilweise
 * übertragener Stand wäre schlimmer als ein sauberer Neuanfang.
 */
import fs from "node:fs";
import { createClient } from "@libsql/client";

const quelle = process.argv[2] ?? "data/finance.db";
const ziel = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!ziel) {
  console.error("TURSO_DATABASE_URL fehlt.");
  process.exit(1);
}
if (!fs.existsSync(quelle)) {
  console.error(`Quelldatenbank nicht gefunden: ${quelle}`);
  process.exit(1);
}

const TABELLEN = [
  "settings",
  "merchant_memory",
  "transactions",
  "budgets",
  "recurring",
  "imports",
] as const;

async function main() {
  const von = createClient({ url: `file:${quelle}` });
  const nach = createClient({ url: ziel!, authToken: token });

  // Schema anlegen, indem die App-eigene Migration angestossen wird.
  process.env.TURSO_DATABASE_URL = ziel;
  const { getDb } = await import("../src/db/index");
  await getDb();

  console.log(`Quelle: ${quelle}\nZiel:   ${ziel}\n`);

  for (const tabelle of TABELLEN) {
    const zeilen = (await von.execute(`SELECT * FROM ${tabelle}`)).rows;
    await nach.execute(`DELETE FROM ${tabelle}`);

    if (zeilen.length === 0) {
      console.log(`  ${tabelle.padEnd(18)} leer`);
      continue;
    }

    const spalten = Object.keys(zeilen[0] as Record<string, unknown>);
    const platzhalter = spalten.map(() => "?").join(",");
    const sql = `INSERT INTO ${tabelle} (${spalten.join(",")}) VALUES (${platzhalter})`;

    /*
     * In Blöcken übertragen. Eine einzelne Anweisung je Zeile wäre bei
     * tausend Buchungen tausend Netzrunden; alles auf einmal sprengt die
     * Grössenbegrenzung einer Anfrage.
     */
    const BLOCK = 200;
    for (let i = 0; i < zeilen.length; i += BLOCK) {
      const block = zeilen.slice(i, i + BLOCK).map((z) => ({
        sql,
        args: spalten.map((s) => (z as Record<string, any>)[s] ?? null),
      }));
      await nach.batch(block, "write");
    }

    console.log(`  ${tabelle.padEnd(18)} ${zeilen.length} Zeilen`);
  }

  // Gegenprobe: die Anzahl Buchungen muss auf beiden Seiten gleich sein.
  const a = (await von.execute("SELECT COUNT(*) n FROM transactions")).rows[0].n;
  const b = (await nach.execute("SELECT COUNT(*) n FROM transactions")).rows[0].n;
  console.log(`\nGegenprobe: ${a} lokal, ${b} bei Turso — ${a === b ? "✓ stimmt" : "✗ WEICHT AB"}`);
  if (a !== b) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
