/** Gemeinsame Domain-Typen. Bewusst framework-frei, damit testbar. */

export type SourceKind = "camt053" | "swisscard" | "manual";

/** Wie eine Buchung in die Auswertung eingeht. */
export type Treatment =
  /** Normale Ausgabe oder Einnahme — zählt voll. */
  | "normal"
  /** Eigenübertrag, Investment, Kreditkarten-Ausgleich — zählt nirgends. */
  | "neutral"
  /** Zahlung, die zurückerwartet wird (Kaution, Auslage für Kollegen). */
  | "receivable";

export type Necessity = "fix" | "noetig" | "freiwillig" | "neutral";

/** Eine geparste Buchung, bevor sie in die Datenbank geht. */
export interface ParsedTransaction {
  /** Stabiler Schlüssel für Deduplizierung über mehrere Importe hinweg. */
  externalId: string;
  source: SourceKind;
  /** IBAN des Lohnkontos bzw. maskierte Kartennummer. */
  accountRef: string;
  /** ISO yyyy-mm-dd */
  bookingDate: string;
  valueDate?: string;
  /** Rappen, negativ = Ausgabe. */
  amount: number;
  currency: string;
  /** Bei Auslandszahlungen: Originalwährung und -betrag. */
  fxCurrency?: string;
  fxAmount?: number;
  /** Ungekürzter Originaltext aus dem Export — nie wegwerfen. */
  rawText: string;
  /** Extrahierter Händler bzw. Person. */
  counterparty?: string;
  counterpartyIban?: string;
  counterpartyPhone?: string;
  /** Uhrzeit aus TWINT-/Kartentexten, z.B. "17:35". */
  txTime?: string;
  /** Ortsangabe, falls im Text erkennbar. */
  place?: string;
  /** Kategorie-Vorschlag des Kartenherausgebers (Swisscard liefert das mit). */
  issuerCategory?: string;
  /** MCC-Klartext von Swisscard. */
  issuerMcc?: string;
  /** ISO-20022 Transaktionscode, z.B. "PMNT/ICDT/AUTT". */
  bankTxCode?: string;
  /** Bei Karten: welche Karte. */
  cardRef?: string;
}

export interface CategoryDef {
  slug: string;
  label: string;
  necessity: Necessity;
  /** Emoji fürs UI. */
  icon: string;
  /** Gruppe fürs Dashboard. */
  group: "fix" | "variabel" | "freiwillig" | "neutral" | "einkommen";
}

export type MatchStage =
  | "gedaechtnis"      // exakt gelernter Händler
  | "marke"            // Marken-Match (Coop Wil == Coop Zürich)
  | "regel"            // eingebautes Regelwerk
  | "struktur"         // aus ISO-Code / eigener IBAN abgeleitet
  | "kartenkategorie"  // Swisscard-Hinweis
  | "ki"               // KI-Fallback
  | "unbekannt";

export interface CategorySuggestion {
  categorySlug: string | null;
  confidence: number;
  stage: MatchStage;
  /** Menschenlesbare Begründung — wird im UI angezeigt, damit nichts Blackbox ist. */
  reason: string;
  treatment?: Treatment;
}
