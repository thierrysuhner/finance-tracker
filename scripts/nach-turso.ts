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

  const BLOCK = 200;

  /** Überträgt Anweisungen in Blöcken, damit weder die Netzrunden noch die
   *  Grösse einer einzelnen Anfrage aus dem Ruder laufen. */
  async function inBloecken(anweisungen: Array<{ sql: string; args: any[] }>) {
    for (let i = 0; i < anweisungen.length; i += BLOCK) {
      await nach.batch(anweisungen.slice(i, i + BLOCK), "write");
    }
  }

  // Nachzureichende Verweise. Siehe Erklärung weiter unten.
  const verweise: Array<{ sql: string; args: any[] }> = [];

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
     * transactions.offset_of zeigt auf eine andere Zeile derselben Tabelle.
     * Ein verrechneter Geldeingang steht aber oft vor der Ausgabe, die er
     * ausgleicht — beim Einfügen gäbe es diese Ausgabe also noch nicht.
     *
     * Lokal fällt das nicht auf, sofern die Datei keine Verrechnung enthält.
     * Turso prüft Fremdschlüssel, und dann bricht der Übertrag mitten in der
     * Tabelle ab.
     *
     * Deshalb in zwei Durchgängen: erst alle Zeilen ohne den Verweis, danach
     * die Verweise nachtragen, wenn beide Seiten existieren. Das kommt ohne
     * PRAGMA-Tricks aus, die innerhalb einer Transaktion ohnehin wirkungslos
     * wären.
     */
    const verweisSpalte = tabelle === "transactions" ? "offset_of" : null;

    await inBloecken(
      zeilen.map((z) => {
        const r = z as Record<string, any>;
        return {
          sql,
          args: spalten.map((s) => (s === verweisSpalte ? null : (r[s] ?? null))),
        };
      }),
    );

    if (verweisSpalte) {
      for (const z of zeilen as unknown as Record<string, any>[]) {
        if (z[verweisSpalte] != null) {
          verweise.push({
            sql: `UPDATE ${tabelle} SET ${verweisSpalte} = ? WHERE id = ?`,
            args: [z[verweisSpalte], z.id],
          });
        }
      }
    }

    console.log(`  ${tabelle.padEnd(18)} ${zeilen.length} Zeilen`);
  }

  if (verweise.length > 0) {
    await inBloecken(verweise);
    console.log(`  ${"verrechnet".padEnd(18)} ${verweise.length} Verweise nachgetragen`);
  }

  // Gegenprobe: Anzahl Buchungen und Verrechnungen müssen beidseitig stimmen.
  const zaehle = async (c: typeof von, sql: string) =>
    Number((await c.execute(sql)).rows[0].n);

  const ALLE = "SELECT COUNT(*) n FROM transactions";
  const VERRECHNET = "SELECT COUNT(*) n FROM transactions WHERE offset_of IS NOT NULL";

  const [aAlle, bAlle, aVerr, bVerr] = await Promise.all([
    zaehle(von, ALLE), zaehle(nach, ALLE),
    zaehle(von, VERRECHNET), zaehle(nach, VERRECHNET),
  ]);

  const ok = aAlle === bAlle && aVerr === bVerr;
  console.log(`\nGegenprobe: ${aAlle} Buchungen lokal, ${bAlle} bei Turso`);
  console.log(`            ${aVerr} verrechnet lokal, ${bVerr} bei Turso`);
  console.log(ok ? "✓ stimmt" : "✗ WEICHT AB");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
