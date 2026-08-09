import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseCamt053 } from "@/core/parsers/camt053";
import { parseSwisscardCsv } from "@/core/parsers/swisscard";
import { formatRappen, sum } from "@/core/money";

/**
 * Prüfung gegen die echten Exporte in data/eingang/.
 *
 * Diese Dateien liegen bewusst NICHT im Repository (siehe .gitignore) — sie
 * enthalten Namen, IBANs und Telefonnummern. Sind sie nicht vorhanden, werden
 * die Tests übersprungen statt zu scheitern.
 *
 * Nutzen im Alltag: nach jedem Monatsimport `npm test` laufen lassen. Schlägt
 * die Saldoprobe fehl, ist beim Import etwas verloren gegangen.
 */

const EINGANG = path.resolve(process.cwd(), "data/eingang");

function findFiles(ext: string): string[] {
  if (!fs.existsSync(EINGANG)) return [];
  return fs
    .readdirSync(EINGANG)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .map((f) => path.join(EINGANG, f));
}

const camtFiles = findFiles(".xml");
const csvFiles = findFiles(".csv");

describe.skipIf(camtFiles.length === 0)("CAMT.053 gegen echte Bankdaten", () => {
  const statements = camtFiles.flatMap((f) =>
    parseCamt053(fs.readFileSync(f, "utf-8")),
  );

  it("liest mindestens einen Kontoauszug", () => {
    expect(statements.length).toBeGreaterThan(0);
  });

  it("Saldoprobe: Summe aller Buchungen entspricht der Saldodifferenz", () => {
    for (const stmt of statements) {
      if (stmt.openingBalance === undefined || stmt.closingBalance === undefined) continue;
      const bewegung = sum(stmt.transactions.map((t) => t.amount));
      const erwartet = stmt.closingBalance - stmt.openingBalance;

      // Diese Probe deckt auf, wenn eine Sammelbuchung falsch aufgeteilt oder
      // eine Buchung stillschweigend verschluckt wurde.
      expect(
        bewegung,
        `Saldoprobe fehlgeschlagen für ${stmt.iban}: ` +
          `Buchungen ergeben ${formatRappen(bewegung)}, ` +
          `Saldodifferenz ist ${formatRappen(erwartet)}`,
      ).toBe(erwartet);
    }
  });

  it("jede Buchung hat Datum, Betrag und eindeutige Referenz", () => {
    for (const stmt of statements) {
      const ids = new Set<string>();
      for (const t of stmt.transactions) {
        expect(t.bookingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isInteger(t.amount)).toBe(true);
        expect(t.amount).not.toBe(0);
        expect(ids.has(t.externalId), `Doppelte Referenz: ${t.externalId}`).toBe(false);
        ids.add(t.externalId);
      }
    }
  });

  it("erkennt bei der grossen Mehrheit eine Gegenpartei", () => {
    const all = statements.flatMap((s) => s.transactions);
    const mitName = all.filter((t) => t.counterparty).length;
    const quote = mitName / all.length;

    // Ohne Gegenpartei kann die Kategorisierung nichts lernen. Unter 90% wäre
    // die Textextraktion kaputt.
    expect(quote, `Nur ${(quote * 100).toFixed(1)}% mit erkannter Gegenpartei`)
      .toBeGreaterThan(0.9);
  });
});

describe.skipIf(csvFiles.length === 0)("Swisscard-CSV gegen echte Kartendaten", () => {
  const imports = csvFiles.map((f) => parseSwisscardCsv(fs.readFileSync(f, "utf-8")));

  it("liest Buchungen und trennt die Ausgleichszahlungen ab", () => {
    for (const imp of imports) {
      expect(imp.transactions.length).toBeGreaterThan(0);
      // Ohne diese Trennung würden die Kartenausgaben doppelt gezählt.
      expect(imp.settlements.length).toBeGreaterThan(0);
      for (const s of imp.settlements) {
        expect(s.amount).toBeGreaterThan(0); // Ausgleich ist ein Zufluss auf dem Kartenkonto
      }
    }
  });

  it("dreht die Vorzeichen in die Cashflow-Sicht", () => {
    for (const imp of imports) {
      const ausgaben = imp.transactions.filter((t) => t.amount < 0);
      // Auf einer Kreditkarte muss die Mehrheit Ausgaben sein.
      expect(ausgaben.length).toBeGreaterThan(imp.transactions.length / 2);
    }
  });

  it("übernimmt Fremdwährungen mit Originalbetrag", () => {
    const fx = imports.flatMap((i) => i.transactions).filter((t) => t.fxCurrency);
    for (const t of fx) {
      expect(t.fxAmount).toBeDefined();
      expect(t.currency).toBe("CHF");
    }
  });

  it("vergibt eindeutige Referenzen trotz fehlender Transaktionsnummer", () => {
    for (const imp of imports) {
      const alle = [...imp.transactions, ...imp.settlements];
      const ids = new Set(alle.map((t) => t.externalId));
      expect(ids.size).toBe(alle.length);
    }
  });
});
