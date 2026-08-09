import { describe, it, expect } from "vitest";
import {
  findeOffsetKandidaten, nettoBetrag, namensAehnlichkeit, type OffsetInput,
} from "@/core/offset/matcher";

function ausgabe(id: number, datum: string, betrag: number, wer: string): OffsetInput {
  return { id, bookingDate: datum, amount: -betrag, counterparty: wer };
}

describe("Namensvergleich", () => {
  it("erkennt dieselbe Person trotz zweitem Vornamen", () => {
    expect(namensAehnlichkeit("lukas maximilian muster", "lukas muster")).toBeGreaterThanOrEqual(0.6);
  });

  it("erkennt denselben Händler trotz Domain-Schreibweise", () => {
    expect(namensAehnlichkeit("wefashion ch", "wefashion")).toBeGreaterThanOrEqual(0.6);
  });

  it("hält Familienmitglieder mit gleichem Nachnamen auseinander", () => {
    // Genau hier lag der Fehler: ein gemeinsamer Nachname reicht nicht.
    expect(namensAehnlichkeit("felix muster", "thierry muster")).toBeLessThan(0.6);
  });
});

describe("Verrechnungsvorschläge", () => {
  const eingang: OffsetInput = {
    id: 100, bookingDate: "2026-04-07", amount: 40000, counterparty: "Felix Muster",
  };

  it("schlägt nichts vor, wenn weder Name noch Betrag passen", () => {
    // Der reale Fehlerfall: 400 Franken der Eltern gegen 488 Franken Miete.
    const treffer = findeOffsetKandidaten(eingang, [
      ausgabe(1, "2026-03-30", 48800, "Maximilian Vermieter"),
      ausgabe(2, "2026-03-04", 60000, "Einkaufszentrum"),
    ]);
    expect(treffer).toHaveLength(0);
  });

  it("schlägt bei gleicher Gegenpartei vor", () => {
    const treffer = findeOffsetKandidaten(
      { id: 100, bookingDate: "2026-04-09", amount: 2490, counterparty: "Lukas Maximilian Muster" },
      [ausgabe(1, "2026-04-08", 5100, "Lukas Muster")],
    );
    expect(treffer).toHaveLength(1);
    expect(treffer[0].ausgabeId).toBe(1);
    expect(treffer[0].grund).toContain("ähnlicher Name");
  });

  it("schlägt bei exakt gleichem Betrag auch ohne Namensbezug vor", () => {
    const treffer = findeOffsetKandidaten(
      { id: 100, bookingDate: "2026-04-10", amount: 5000, counterparty: "Unbekannt" },
      [ausgabe(1, "2026-04-08", 5000, "Irgendein Laden")],
    );
    expect(treffer).toHaveLength(1);
    expect(treffer[0].grund).toContain("exakt");
  });

  it("erkennt eine Kartenretoure als Rückerstattung des Händlers", () => {
    const treffer = findeOffsetKandidaten(
      { id: 100, bookingDate: "2026-06-04", amount: 5520, counterparty: "WEFASHION.CH" },
      [ausgabe(1, "2026-04-12", 11315, "WE Fashion")],
    );
    expect(treffer).toHaveLength(1);
  });

  it("ignoriert Rückzahlungen vor der Ausgabe", () => {
    const treffer = findeOffsetKandidaten(
      { id: 100, bookingDate: "2026-04-01", amount: 5000, counterparty: "Lukas Muster" },
      [ausgabe(1, "2026-04-08", 5000, "Lukas Muster")],
    );
    expect(treffer).toHaveLength(0);
  });

  it("ignoriert Rückzahlungen, die grösser sind als die Ausgabe", () => {
    const treffer = findeOffsetKandidaten(
      { id: 100, bookingDate: "2026-04-10", amount: 20000, counterparty: "Lukas Muster" },
      [ausgabe(1, "2026-04-08", 5000, "Lukas Muster")],
    );
    expect(treffer).toHaveLength(0);
  });
});

describe("Nettobetrag", () => {
  it("zieht Rückzahlungen von der Ausgabe ab", () => {
    // 60 Franken Restaurant, zwei Kollegen zahlen je 20 zurück.
    expect(nettoBetrag(-6000, [2000, 2000])).toBe(-2000);
  });

  it("kappt bei null statt ein Guthaben auszuweisen", () => {
    expect(nettoBetrag(-5000, [6000])).toBe(0);
  });

  it("lässt eine Ausgabe ohne Rückzahlung unverändert", () => {
    expect(nettoBetrag(-5000, [])).toBe(-5000);
  });
});
