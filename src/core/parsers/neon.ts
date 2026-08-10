import Papa from "papaparse";
import { parseAmountToRappen } from "../money";
import type { ParsedTransaction } from "../types";

/**
 * Parser für den Kontoauszug von neon (CSV).
 *
 * Das neon-Konto wird für Fremdwährungsausgaben genutzt und vom Hauptkonto
 * aus aufgeladen. Beide Seiten zu zählen wäre doppelt: die Aufladung ist eine
 * Umbuchung, die eigentliche Ausgabe passiert erst auf neon. Deshalb wird die
 * Aufladung neutral gestellt und die neon-Buchungen zählen.
 *
 * Anders als bei Swisscard stimmen die Vorzeichen bereits: neon führt den
 * Auszug aus Sicht des Kontoinhabers, eine Ausgabe steht also negativ da.
 *
 * Feldtrenner ist das Semikolon, nicht das Komma.
 */

export interface NeonImport {
  transactions: ParsedTransaction[];
  warnings: string[];
}

/** neon liefert eine eigene grobe Einteilung mit. */
const NEON_KATEGORIEN: Record<string, string> = {
  food: "auswaerts",         // deckt überwiegend Restaurants und Take-away ab
  groceries: "lebensmittel",
  shopping: "shopping",
  transport: "mobilitaet",
  travel: "reisen",
  leisure: "freizeit",
  household: "haushalt",
  health: "gesundheit",
  housing: "miete",
  education: "ausbildung",
  finances: "gebuehren",
  income: "einkommen_sonstig",
  // "uncategorized" bewusst nicht abgebildet — das führt zur Nachfrage.
};

const SPALTEN: Record<string, string[]> = {
  date: ["date", "datum"],
  amount: ["amount", "betrag"],
  fxAmount: ["original amount", "originalbetrag"],
  fxCurrency: ["original currency", "originalwährung", "originalwahrung"],
  description: ["description", "beschreibung"],
  subject: ["subject", "zweck", "mitteilung"],
  category: ["category", "kategorie"],
};

function spaltenZuordnen(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, aliase] of Object.entries(SPALTEN)) {
    const treffer = headers.find((h) =>
      aliase.includes(h.trim().toLowerCase().replace(/^﻿/, "")),
    );
    if (treffer) map[key] = treffer;
  }
  return map;
}

function stabileId(teile: string[], gesehen: Map<string, number>): string {
  const basis = teile.join("|").toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const key = hash.toString(36);
  const n = (gesehen.get(key) ?? 0) + 1;
  gesehen.set(key, n);
  return n === 1 ? `neon_${key}` : `neon_${key}#${n}`;
}

/** Erkennt am Kopf, ob es sich um einen neon-Auszug handelt. */
export function istNeonCsv(inhalt: string): boolean {
  const kopf = inhalt.slice(0, 400).toLowerCase();
  return (
    kopf.includes(";") &&
    kopf.includes("original currency") &&
    (kopf.includes("wise") || kopf.includes("spaces") || kopf.includes("subject"))
  );
}

export function parseNeonCsv(csv: string): NeonImport {
  const sauber = csv.replace(/^﻿/, "");
  const ergebnis = Papa.parse<Record<string, string>>(sauber, {
    header: true,
    delimiter: ";",
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const headers = ergebnis.meta.fields ?? [];
  const col = spaltenZuordnen(headers);

  if (!col.date || !col.amount) {
    throw new Error(
      `neon-Auszug nicht lesbar. Gelesene Spalten: ${headers.join(", ")}. ` +
        `Erwartet werden mindestens "Date" und "Amount".`,
    );
  }

  const gesehen = new Map<string, number>();

  for (const zeile of ergebnis.data) {
    const datum = (zeile[col.date] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      if (datum) warnings.push(`Zeile mit unlesbarem Datum übersprungen: "${datum}"`);
      continue;
    }

    const rohBetrag = (zeile[col.amount] ?? "").trim();
    if (!rohBetrag) continue;

    let betrag: number;
    try {
      betrag = parseAmountToRappen(rohBetrag);
    } catch {
      warnings.push(`${datum}: Betrag "${rohBetrag}" nicht lesbar — übersprungen.`);
      continue;
    }

    const beschreibung = (zeile[col.description] ?? "").trim();
    const zweck = (zeile[col.subject] ?? "").trim();
    const neonKategorie = (zeile[col.category] ?? "").trim().toLowerCase();

    const fxWaehrung = (zeile[col.fxCurrency] ?? "").trim();
    const rohFx = (zeile[col.fxAmount] ?? "").trim();
    let fxBetrag: number | undefined;
    if (rohFx) {
      try {
        fxBetrag = Math.abs(parseAmountToRappen(rohFx));
      } catch {
        // Fremdwährungsbetrag ist Zusatzinformation, kein Grund zum Abbruch.
      }
    }

    transactions.push({
      externalId: stabileId([datum, rohBetrag, beschreibung, zweck], gesehen),
      source: "neon",
      accountRef: "neon",
      bookingDate: datum,
      amount: betrag,
      currency: "CHF",
      fxCurrency: fxWaehrung || undefined,
      fxAmount: fxBetrag,
      // Zweck mitführen: dort stehen die Hinweise auf Umbuchungen
      // ("Kontouebertrag", "Ferien Toscana").
      rawText: [beschreibung, zweck].filter(Boolean).join(" | "),
      counterparty: beschreibung || zweck || undefined,
      issuerCategory: NEON_KATEGORIEN[neonKategorie] ? neonKategorie : undefined,
    });
  }

  for (const e of ergebnis.errors.slice(0, 5)) {
    warnings.push(`CSV-Warnung Zeile ${e.row}: ${e.message}`);
  }

  return { transactions, warnings };
}

/** Übersetzt eine neon-Kategorie in die eigene Taxonomie. */
export function neonKategorie(neon: string | undefined): string | undefined {
  if (!neon) return undefined;
  return NEON_KATEGORIEN[neon.trim().toLowerCase()];
}
