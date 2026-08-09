import Papa from "papaparse";
import { parseAmountToRappen } from "../money.js";
import type { ParsedTransaction } from "../types.js";

/**
 * Parser für den Transaktionsexport von Swisscard (Cashback/Visa/Mastercard).
 *
 * Zwei Eigenheiten, die man kennen muss:
 *
 * 1. VORZEICHEN SIND GEDREHT. Die Datei zeigt die Sicht des Kartenherausgebers:
 *    eine Belastung erhöht die Schuld und steht positiv da. Im Tracker gilt die
 *    Cashflow-Sicht (Ausgabe = negativ), deshalb wird durchgängig negiert.
 *
 * 2. DIE LSV-ZEILEN SIND KEINE AUSGABEN. "IHRE ZAHLUNG (LSV) – BESTEN DANK" ist
 *    der Ausgleich der Monatsrechnung. Derselbe Betrag erscheint bereits als
 *    SWISSCARD-Belastung im Bankauszug. Würde man beides zählen, wären die
 *    Kartenausgaben doppelt drin. Diese Zeilen werden als Ausgleich markiert
 *    und in der Auswertung neutralisiert.
 */

export interface SwisscardImport {
  transactions: ParsedTransaction[];
  /** Ausgleichszahlungen — dienen dem Abgleich mit dem Bankauszug. */
  settlements: ParsedTransaction[];
  warnings: string[];
}

/** Erkennt die Ausgleichszahlung der Monatsrechnung. */
const SETTLEMENT = /ihre zahlung|besten dank|paiement|your payment|lsv/i;

/** Spaltennamen tolerant auflösen (DE/EN/FR-Exporte). */
const COLUMNS: Record<string, string[]> = {
  date: ["transaktionsdatum", "date de transaction", "transaction date", "datum"],
  description: ["beschreibung", "description", "libellé", "libelle"],
  merchant: ["händler", "haendler", "commerçant", "commercant", "merchant"],
  card: ["kartennummer", "numéro de carte", "numero de carte", "card number"],
  currency: ["währung", "waehrung", "monnaie", "currency"],
  amount: ["betrag", "montant", "amount"],
  fxCurrency: ["fremdwährung", "fremdwaehrung", "monnaie étrangère", "foreign currency"],
  fxAmount: [
    "betrag in fremdwährung", "betrag in fremdwaehrung",
    "montant en monnaie étrangère", "amount in foreign currency",
  ],
  direction: ["debit/kredit", "débit/crédit", "debit/credit"],
  status: ["status", "statut", "state"],
  issuerCategory: ["händlerkategorie", "haendlerkategorie", "catégorie", "merchant category"],
  issuerMcc: ["registrierte kategorie", "catégorie enregistrée", "registered category"],
};

function buildHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const found = headers.find((h) =>
      aliases.includes(h.trim().toLowerCase().replace(/^﻿/, "")),
    );
    if (found) map[key] = found;
  }
  return map;
}

/** "05.08.2026" -> "2026-08-05" */
function toIsoDate(raw: string): string | undefined {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // US-Format als Fallback
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return undefined;
}

/**
 * Stabile ID ohne Transaktionsnummer.
 *
 * Swisscard liefert keine eindeutige Referenz mit, deshalb wird aus den
 * inhaltlichen Feldern ein Schlüssel gebildet. Der Zähler am Ende trennt
 * mehrere identische Buchungen am selben Tag (zwei Billette zu je 8 Franken
 * sind ein realistischer Fall).
 */
function makeExternalId(parts: string[], seen: Map<string, number>): string {
  const base = parts.join("|").toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const key = hash.toString(36);
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  return n === 1 ? `sc_${key}` : `sc_${key}#${n}`;
}

export function parseSwisscardCsv(csv: string): SwisscardImport {
  const clean = csv.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const settlements: ParsedTransaction[] = [];

  const headers = result.meta.fields ?? [];
  const col = buildHeaderMap(headers);

  for (const required of ["date", "amount"] as const) {
    if (!col[required]) {
      throw new Error(
        `Spalte für "${required}" nicht gefunden. Gelesene Spalten: ${headers.join(", ")}. ` +
          `Erwartet wird der Transaktionsexport aus dem Swisscard-Portal (CSV).`,
      );
    }
  }

  const seen = new Map<string, number>();

  for (const row of result.data) {
    const rawDate = row[col.date] ?? "";
    const bookingDate = toIsoDate(rawDate);
    if (!bookingDate) {
      if (rawDate.trim()) warnings.push(`Zeile mit unlesbarem Datum übersprungen: "${rawDate}"`);
      continue;
    }

    const status = (row[col.status] ?? "").trim().toLowerCase();
    // Vorgemerkte Buchungen ändern beim nächsten Export noch Betrag und Text.
    if (status && !/gebucht|verbucht|booked|comptabilis/i.test(status)) {
      warnings.push(
        `${bookingDate}: "${(row[col.description] ?? "").slice(0, 40)}" ist noch nicht gebucht (${status}) — beim nächsten Import erneut prüfen.`,
      );
      continue;
    }

    const rawAmount = (row[col.amount] ?? "").trim();
    if (!rawAmount) continue;

    let issuerAmount: number;
    try {
      issuerAmount = parseAmountToRappen(rawAmount);
    } catch {
      warnings.push(`${bookingDate}: Betrag "${rawAmount}" nicht lesbar — Zeile übersprungen.`);
      continue;
    }

    // Sicht des Herausgebers in Cashflow-Sicht drehen.
    const amount = -issuerAmount;

    // Gegenprobe mit der Richtungsspalte, falls vorhanden.
    const direction = (row[col.direction] ?? "").trim().toLowerCase();
    if (direction) {
      const expectDebit = /belastung|débit|debit/i.test(direction);
      if (expectDebit && amount > 0) {
        warnings.push(
          `${bookingDate}: als "${direction}" markiert, Betrag ${rawAmount} deutet aber in die andere Richtung.`,
        );
      }
    }

    const description = (row[col.description] ?? "").trim();
    // Satzzeichen an den Rändern abräumen — der Export liefert Namen wie
    // "FIVE STAR NORTH AMERICA," mitsamt abgeschnittenem Komma.
    const merchant = (row[col.merchant] ?? "").replace(/^[,;\s]+|[,;\s]+$/g, "").trim();
    const card = (row[col.card] ?? "").trim();

    // Ort aus "SBB MOBILE, BERN" abtrennen — der Teil nach dem letzten Komma.
    let place: string | undefined;
    const descParts = description.split(",");
    if (descParts.length > 1) {
      const tail = descParts[descParts.length - 1].trim();
      if (tail && !/^\d+$/.test(tail)) place = tail;
    }

    const fxCurrencyRaw = (row[col.fxCurrency] ?? "").trim();
    const fxAmountRaw = (row[col.fxAmount] ?? "").trim();

    const tx: ParsedTransaction = {
      externalId: makeExternalId([bookingDate, description, card, rawAmount], seen),
      source: "swisscard",
      accountRef: card || "swisscard",
      cardRef: card || undefined,
      bookingDate,
      amount,
      currency: (row[col.currency] ?? "CHF").trim() || "CHF",
      fxCurrency: fxCurrencyRaw || undefined,
      fxAmount: fxAmountRaw ? parseAmountToRappen(fxAmountRaw) : undefined,
      rawText: description,
      // Das Händlerfeld ist gepflegter als die Beschreibung ("Apple" statt
      // "APPLE.COM/BILL, HOLLYHILL") und deshalb der bessere Lernschlüssel.
      counterparty: merchant || description.split(",")[0].trim() || undefined,
      place,
      issuerCategory: (row[col.issuerCategory] ?? "").trim() || undefined,
      issuerMcc: (row[col.issuerMcc] ?? "").trim() || undefined,
    };

    if (SETTLEMENT.test(description)) {
      settlements.push(tx);
    } else {
      transactions.push(tx);
    }
  }

  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) {
      warnings.push(`CSV-Warnung Zeile ${e.row}: ${e.message}`);
    }
  }

  return { transactions, settlements, warnings };
}
