import { describe, it, expect } from "vitest";
import { extractParty, merchantKey, brandKey } from "@/core/parsers/party";
import { parseAmountToRappen, formatRappen, median } from "@/core/money";

/**
 * Die Testfälle bilden reale Textformen aus einem CAMT.053 der Hypothekarbank
 * Lenzburg nach — mit erfundenen Namen, damit keine echten Personendaten im
 * Repository liegen. Die Struktur der Texte ist identisch mit dem Original.
 */

describe("extractParty", () => {
  it("trennt Uhrzeit, Händler und Ort einer Kartenzahlung", () => {
    const r = extractParty("17:35 Uhr, Migros Mr Gastronomie \n9200 Gossau SG");
    expect(r.time).toBe("17:35");
    expect(r.name).toBe("Migros Mr Gastronomie");
    expect(r.place).toBe("9200 Gossau SG");
  });

  it("dreht 'Nachname, Vorname' einer TWINT-Zahlung und erkennt die Person", () => {
    const r = extractParty("00:49 Uhr, Muster, Lukas \n+41780000000");
    expect(r.name).toBe("Lukas Muster");
    expect(r.phone).toBe("+41780000000");
    expect(r.isPerson).toBe(true);
  });

  it("überspringt die Anrede und nimmt den Namen darunter", () => {
    const r = extractParty(
      "Herr \nMax Beispiel \nMusterweg 2 \n5616 Meisterschwanden",
    );
    expect(r.name).toBe("Max Beispiel");
    expect(r.place).toBe("5616 Meisterschwanden");
  });

  it("verwirft Strassen- und Länderzeilen einer Überweisung", () => {
    const r = extractParty(
      "Universitaet St. Gallen \nDufourstrasse 50 \n9000 St.Gallen \nCH",
    );
    expect(r.name).toBe("Universitaet St. Gallen");
  });

  it("kommt mit ausländischen Adressformaten zurecht", () => {
    const r = extractParty(
      "Beispiel Comm. Luigi Rossi \nvia Roberto Sarfatti 25 20136 Milano Mi \nIT",
    );
    expect(r.name).toBe("Beispiel Comm. Luigi Rossi");
  });

  it("liefert keinen Namen bei reinen Banktexten", () => {
    expect(extractParty("Gutschrift lt. Avis").name).toBeUndefined();
    expect(extractParty("Gebuehren").name).toBeUndefined();
  });

  it("behält den Namen, wenn die zweite Zeile 'Postfach' ist", () => {
    const r = extractParty("SWISSCARD AECS GMBH \nPOSTFACH \nCH-8810 HORGEN");
    expect(r.name).toBe("SWISSCARD AECS GMBH");
  });

  it("verkraftet leeren Text", () => {
    expect(extractParty("").name).toBeUndefined();
  });
});

describe("merchantKey / brandKey", () => {
  it("normalisiert Umlaute und Sonderzeichen", () => {
    expect(merchantKey("Café Zürich-Süd")).toBe("cafe zurich sud");
  });

  it("führt Filialen derselben Marke zusammen", () => {
    expect(brandKey("Coop-Zuerich Bahnhof")).toBe(brandKey("Coop-Zuerich Sihl"));
  });

  it("hält ähnliche, aber verschiedene Marken auseinander", () => {
    // Migros ist ein Detailhändler, Migrol eine Tankstelle — nicht dasselbe Budget.
    expect(brandKey("Migros Gossau")).not.toBe(brandKey("Migrol Tankstelle Stans"));
  });

  it("entfernt Filialnummern", () => {
    expect(brandKey("Coop Pronto 3658 Basel")).toBe("coop pronto");
  });
});

describe("Geldbeträge", () => {
  it("liest Schweizer und internationale Schreibweisen", () => {
    expect(parseAmountToRappen("1'874.15")).toBe(187415);
    expect(parseAmountToRappen("1234.56")).toBe(123456);
    expect(parseAmountToRappen("-58.80")).toBe(-5880);
    expect(parseAmountToRappen("2.9")).toBe(290);
    expect(parseAmountToRappen("51")).toBe(5100);
  });

  it("rechnet ohne Fliesskomma-Fehler", () => {
    // 0.1 + 0.2 in Fliesskomma ergibt 0.30000000000000004.
    const total = parseAmountToRappen("0.10") + parseAmountToRappen("0.20");
    expect(total).toBe(parseAmountToRappen("0.30"));
  });

  it("formatiert mit Schweizer Tausendertrennzeichen", () => {
    expect(formatRappen(187415)).toBe("1'874.15");
    expect(formatRappen(-5680000)).toBe("−56'800.00");
  });

  it("ignoriert Ausreisser beim Median", () => {
    // Ein Monat mit einer 17'000er-Umschichtung darf das Budget nicht kippen.
    const monate = [126000, 179000, 109000, 140000, 106000, 1700000];
    expect(median(monate)).toBe(133000);
  });
});
