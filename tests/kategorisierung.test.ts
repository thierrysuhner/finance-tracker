import { describe, it, expect } from "vitest";
import {
  categorize, emptyContext, needsReview, lerneAusHistorie, memoryKey,
} from "@/core/categorize/engine";
import { merchantKey } from "@/core/parsers/party";
import type { ParsedTransaction } from "@/core/types";

function tx(over: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    externalId: "t1",
    source: "camt053",
    accountRef: "CH00",
    bookingDate: "2026-05-01",
    amount: -1000,
    currency: "CHF",
    rawText: "",
    ...over,
  };
}

describe("Regelwerk", () => {
  it("trennt Detailhandel, Restaurant und Tankstelle derselben Dachmarke", () => {
    // Diese drei sehen ähnlich aus, gehören aber in verschiedene Budgets.
    expect(categorize(tx({ counterparty: "Migros M Bahnhof" })).categorySlug).toBe("lebensmittel");
    expect(categorize(tx({ counterparty: "Migros Mr Gastronomie" })).categorySlug).toBe("auswaerts");
    expect(categorize(tx({ counterparty: "Migrol Tankstelle" })).categorySlug).toBe("mobilitaet");
  });

  it("ordnet Coop-Filialen unabhängig von der Filialnummer zu", () => {
    for (const name of ["Coop-5855 SG City K.", "Coop-4643 Meisterschwa", "Coop Pronto 3658"]) {
      expect(categorize(tx({ counterparty: name })).categorySlug).toBe("lebensmittel");
    }
  });

  it("führt SBB als Mobilität, nicht als Reisen", () => {
    // Swisscard sortiert Billette unter "Reisen". Pendeln gehört aber ins
    // Alltagsbudget, sonst sieht jeder Monat wie eine Ferienreise aus.
    const r = categorize(tx({ counterparty: "SBB CFF FFS", issuerCategory: "Reisen" }));
    expect(r.categorySlug).toBe("mobilitaet");
  });
});

describe("Struktur-Erkennung", () => {
  it("erkennt Überträge aufs eigene Konto als neutral", () => {
    const ctx = emptyContext({ ownNameKeys: [merchantKey("Max Muster")] });
    const r = categorize(tx({ counterparty: "Max Muster", amount: -1700000 }), ctx);
    expect(r.categorySlug).toBe("eigenuebertrag");
    expect(r.treatment).toBe("neutral");
  });

  it("erkennt die eigene IBAN als Gegenkonto", () => {
    const ctx = emptyContext({ ownIbans: ["CH9300762011623852957"] });
    const r = categorize(tx({ counterpartyIban: "CH9300762011623852957" }), ctx);
    expect(r.treatment).toBe("neutral");
    expect(r.confidence).toBe(1);
  });

  it("nutzt den ISO-Code für Lohnzahlungen", () => {
    const r = categorize(tx({ amount: 169415, bankTxCode: "PMNT/RCDT/SALA" }));
    expect(r.categorySlug).toBe("lohn");
  });
});

describe("Geldeingänge", () => {
  it("verbucht Eingänge von Ausgaben-Händlern als Rückerstattung, nicht als Ertrag", () => {
    // Sonst landete eine Vereinsgutschrift in "Ausgehen & Kultur" und würde
    // die Ausgaben dieser Kategorie optisch senken.
    const r = categorize(tx({ counterparty: "Students Consulting Club", amount: 152111 }));
    expect(r.categorySlug).toBe("erstattung");
    expect(r.treatment).toBe("neutral");
    expect(needsReview(r)).toBe(true);
  });

  it("fragt bei Zahlungen an Privatpersonen nach", () => {
    const r = categorize(tx({ counterparty: "Lukas Muster", counterpartyPhone: "+41780000000" }));
    expect(r.categorySlug).toBeNull();
    expect(needsReview(r)).toBe(true);
  });
});

describe("Lernen aus der Historie", () => {
  it("übernimmt eine Zuordnung, die mehrfach gleich getroffen wurde", () => {
    const memory = lerneAusHistorie([
      { counterparty: "Beiz zum Baeren", categorySlug: "auswaerts" },
      { counterparty: "Beiz zum Baeren", categorySlug: "auswaerts" },
      { counterparty: "Beiz zum Baeren", categorySlug: "auswaerts" },
    ]);
    const r = categorize(tx({ counterparty: "Beiz zum Baeren" }), emptyContext({ memory }));
    expect(r.categorySlug).toBe("auswaerts");
    expect(r.stage).toBe("gedaechtnis");
  });

  it("lernt nichts aus widersprüchlichen Zuordnungen", () => {
    const memory = lerneAusHistorie([
      { counterparty: "Unklar AG", categorySlug: "auswaerts" },
      { counterparty: "Unklar AG", categorySlug: "shopping" },
    ]);
    expect(memory.has(memoryKey("exakt", "unklar ag"))).toBe(false);
  });

  it("fragt nach, wenn der Betrag stark vom gelernten Muster abweicht", () => {
    // Der Vermieter bekommt monatlich 488 Franken Miete. Kommen plötzlich
    // 43 Franken per TWINT, ist das keine Miete.
    const memory = lerneAusHistorie([
      { counterparty: "V. Mieter", categorySlug: "miete", amount: -48800 },
      { counterparty: "V. Mieter", categorySlug: "miete", amount: -48800 },
      { counterparty: "V. Mieter", categorySlug: "miete", amount: -48800 },
      { counterparty: "V. Mieter", categorySlug: "miete", amount: -48800 },
    ]);
    const ctx = emptyContext({ memory });

    const miete = categorize(tx({ counterparty: "V. Mieter", amount: -48800 }), ctx);
    expect(needsReview(miete)).toBe(false);

    const twint = categorize(tx({ counterparty: "V. Mieter", amount: -4300 }), ctx);
    expect(needsReview(twint), "Abweichender Betrag muss nachgefragt werden").toBe(true);
  });

  it("setzt keinen Richtbetrag, wo die Beträge naturgemäss schwanken", () => {
    const memory = lerneAusHistorie([
      { counterparty: "Laden", categorySlug: "lebensmittel", amount: -350 },
      { counterparty: "Laden", categorySlug: "lebensmittel", amount: -8900 },
      { counterparty: "Laden", categorySlug: "lebensmittel", amount: -2100 },
      { counterparty: "Laden", categorySlug: "lebensmittel", amount: -15000 },
    ]);
    expect(memory.get(memoryKey("exakt", "laden"))?.typicalAmount).toBeUndefined();

    // Ein grosser Einkauf darf hier keine Rückfrage auslösen.
    const r = categorize(tx({ counterparty: "Laden", amount: -20000 }), emptyContext({ memory }));
    expect(needsReview(r)).toBe(false);
  });
});
