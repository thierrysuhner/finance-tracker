import type { CategorySuggestion, ParsedTransaction, Treatment } from "../types";
import { merchantKey, brandKey } from "../parsers/party";
import { median } from "../money";
import { RULES, ISSUER_CATEGORY_MAP } from "./rules";
import { CATEGORY_BY_SLUG } from "./categories";

/**
 * Mehrstufige Kategorisierung.
 *
 * Die Reihenfolge ist der ganze Trick. Von oben nach unten nimmt die
 * Verlässlichkeit ab, deshalb gewinnt die erste Stufe, die greift:
 *
 *   1. Struktur      Eigenes Konto, Kartenausgleich, Lohncode — praktisch sicher.
 *   2. Gedächtnis    Genau dieser Händler wurde schon einmal bestätigt.
 *   3. Marke         Eine andere Filiale derselben Marke wurde bestätigt.
 *   4. Regelwerk     Bekannte Firma aus der Regeltabelle.
 *   5. Kartenhinweis Grobe Einteilung des Kartenherausgebers.
 *   6. KI            Nur für den Rest, und nur wenn konfiguriert.
 *
 * Alles unterhalb der Konfidenzschwelle landet in der Nachfrage-Liste, statt
 * still falsch einsortiert zu werden. Lieber einmal fragen als monatelang
 * eine schiefe Auswertung zeigen.
 */

export interface MemoryEntry {
  categorySlug: string;
  treatment?: Treatment;
  /** Wie oft bestätigt — mehrfach bestätigt schlägt einmalig. */
  confirmations: number;
  /** Vom Nutzer gesetzt statt geraten. */
  manual: boolean;
  /**
   * Typischer Betrag dieses Händlers in Rappen, falls stabil.
   *
   * Hintergrund: dieselbe Person kann in zwei Rollen auftauchen. Der Vermieter
   * bekommt monatlich einen festen Betrag als Miete — und gelegentlich per
   * TWINT zwanzig Franken fürs Mittagessen. Ohne Betragsprüfung würde das
   * Mittagessen als Miete verbucht.
   */
  typicalAmount?: number;
}

export interface CategorizeContext {
  /** Gelernte Zuordnungen, Schlüssel: "exakt:<key>" bzw. "marke:<key>". */
  memory: Map<string, MemoryEntry>;
  /**
   * Eigene Namen und IBANs. Bewusst Konfiguration statt Code — hier stehen
   * Klarnamen drin, die nicht ins Repository gehören.
   */
  ownNameKeys: string[];
  ownIbans: string[];
  /**
   * Konten für Anlagen und langfristiges Sparen.
   *
   * Getrennt von den übrigen eigenen Konten, obwohl beide neutral zählen:
   * "wie viel habe ich investiert" ist eine andere Frage als "wie viel habe
   * ich zwischen meinen Konten hin- und hergeschoben".
   */
  investmentIbans: string[];
  /** Unterhalb dieser Konfidenz wird nachgefragt. Standard 0.75. */
  reviewThreshold: number;
}

export const DEFAULT_REVIEW_THRESHOLD = 0.75;

export function emptyContext(overrides: Partial<CategorizeContext> = {}): CategorizeContext {
  return {
    memory: new Map(),
    ownNameKeys: [],
    ownIbans: [],
    investmentIbans: [],
    reviewThreshold: DEFAULT_REVIEW_THRESHOLD,
    ...overrides,
  };
}

export function memoryKey(kind: "exakt" | "marke", key: string): string {
  return `${kind}:${key}`;
}

/**
 * Kategorisiert eine Buchung ohne Netzzugriff.
 *
 * Deckt nach Erfahrung mit echten Kontodaten den Grossteil ab, weil dieselben
 * zwanzig Orte immer wiederkehren. Die KI-Stufe ist optional und wird separat
 * in categorizeWithAi() angehängt.
 */
export function categorize(
  tx: ParsedTransaction,
  ctx: CategorizeContext = emptyContext(),
): CategorySuggestion {
  const isExpense = tx.amount < 0;
  const direction: "out" | "in" = isExpense ? "out" : "in";
  const name = tx.counterparty?.trim() ?? "";
  const key = name ? merchantKey(name) : "";
  const brand = name ? brandKey(name) : "";

  // ── 1. Struktur ─────────────────────────────────────────────────────────
  // Anlagekonto: die IBAN ist der verlässlichste Hinweis, der Zwecktext der
  // zweite. Beides prüfen, weil nicht jede Bank die Gegen-IBAN mitliefert.
  const zweck = `${tx.rawText ?? ""}`.toLowerCase();
  if (
    (tx.counterpartyIban && ctx.investmentIbans.includes(tx.counterpartyIban)) ||
    /\binvestment/.test(zweck)
  ) {
    return {
      categorySlug: "investment",
      confidence: 1,
      stage: "struktur",
      treatment: "neutral",
      reason: tx.counterpartyIban && ctx.investmentIbans.includes(tx.counterpartyIban)
        ? "Gegenkonto ist als Anlagekonto hinterlegt"
        : 'Zahlungszweck lautet "Investments"',
    };
  }

  // Eigene IBAN als Gegenpartei: das Geld hat den eigenen Bereich nie
  // verlassen. Weder Ausgabe noch Einnahme.
  if (tx.counterpartyIban && ctx.ownIbans.includes(tx.counterpartyIban)) {
    return {
      categorySlug: "eigenuebertrag",
      confidence: 1,
      stage: "struktur",
      treatment: "neutral",
      reason: "Gegenkonto ist ein eigenes Konto",
    };
  }

  if (key && ctx.ownNameKeys.some((own) => key === own || key.startsWith(own))) {
    return {
      categorySlug: "eigenuebertrag",
      confidence: 0.97,
      stage: "struktur",
      treatment: "neutral",
      reason: `Gegenpartei "${name}" ist als eigenes Konto hinterlegt`,
    };
  }

  // ISO-20022-Code für Lohnzahlung. Verlässlicher als jeder Text.
  if (!isExpense && tx.bankTxCode?.includes("SALA")) {
    return {
      categorySlug: "lohn",
      confidence: 0.95,
      stage: "struktur",
      reason: "Banktransaktionscode weist die Buchung als Lohnzahlung aus",
    };
  }

  // ── 2. Gedächtnis: exakt dieser Händler ─────────────────────────────────
  if (key) {
    const exact = ctx.memory.get(memoryKey("exakt", key));
    if (exact) {
      // Mehrfach bestätigt heisst gesichert; einmal gesetzt bleibt knapp darunter.
      const basis = exact.manual ? (exact.confirmations >= 2 ? 1 : 0.96) : 0.9;
      return withAmountCheck(
        {
          categorySlug: exact.categorySlug,
          confidence: basis,
          stage: "gedaechtnis",
          treatment: exact.treatment,
          reason: exact.manual
            ? `Von dir für "${name}" festgelegt`
            : `Aus früheren Buchungen von "${name}" gelernt`,
        },
        exact,
        tx.amount,
        name,
        isExpense,
      );
    }
  }

  // ── 3. Gedächtnis: andere Filiale derselben Marke ───────────────────────
  if (brand) {
    const byBrand = ctx.memory.get(memoryKey("marke", brand));
    if (byBrand) {
      return withAmountCheck(
        {
          categorySlug: byBrand.categorySlug,
          confidence: 0.88,
          stage: "marke",
          treatment: byBrand.treatment,
          reason: `Andere Filiale von "${brand}" wurde bereits zugeordnet`,
        },
        byBrand,
        tx.amount,
        name,
        isExpense,
      );
    }
  }

  // ── 4. Regelwerk ────────────────────────────────────────────────────────
  if (key) {
    for (const rule of RULES) {
      if (rule.direction && rule.direction !== direction) continue;
      if (!rule.match.test(key)) continue;

      const cat = CATEGORY_BY_SLUG.get(rule.category);
      // Einkommenskategorie bei einer Ausgabe wäre falsch.
      if (cat?.group === "einkommen" && isExpense) continue;

      // Umgekehrt: Geld, das von einem Ausgaben-Händler zurückkommt, ist keine
      // Ausgabe, sondern eine Rückerstattung. Ohne diese Prüfung landete eine
      // Gutschrift eines Vereins in "Ausgehen & Kultur" und schönte die Bilanz.
      if (!isExpense && istAusgabenGruppe(cat?.group) && rule.treatment !== "neutral") {
        return rueckerstattung(name);
      }

      return {
        categorySlug: rule.category,
        confidence: rule.confidence ?? 0.85,
        stage: "regel",
        treatment: rule.treatment,
        reason: rule.why,
      };
    }
  }

  // ── 5. Hinweis des Kartenherausgebers ───────────────────────────────────
  if (tx.issuerCategory) {
    const mapped = ISSUER_CATEGORY_MAP[tx.issuerCategory.trim().toLowerCase()];
    if (mapped && !(CATEGORY_BY_SLUG.get(mapped)?.group === "einkommen" && isExpense)) {
      return {
        categorySlug: mapped,
        // Bewusst unter der Schwelle: die Einteilung von Swisscard ist grob.
        // "Dienstleistungen" für ein iCloud-Abo trifft es nur ungefähr.
        confidence: 0.55,
        stage: "kartenkategorie",
        reason: `Swisscard führt "${name}" unter "${tx.issuerCategory}"`,
      };
    }
  }

  // ── 6. Privatperson ohne Vorgeschichte ──────────────────────────────────
  // Eine TWINT-Zahlung an eine Person kann alles sein: geteilte Rechnung,
  // Konzertticket, geliehenes Geld. Raten wäre hier schädlich.
  if (tx.counterpartyPhone) {
    return {
      categorySlug: null,
      confidence: 0.25,
      stage: "unbekannt",
      reason: `Zahlung an Privatperson (${name}) — kann geteilte Rechnung oder Auslage sein`,
    };
  }

  // ── 7. Einnahme ohne passende Regel ─────────────────────────────────────
  if (!isExpense) {
    return {
      categorySlug: "einkommen_sonstig",
      confidence: 0.4,
      stage: "unbekannt",
      reason: "Geldeingang ohne erkannte Quelle",
    };
  }

  return {
    categorySlug: null,
    confidence: 0,
    stage: "unbekannt",
    reason: name ? `"${name}" ist noch unbekannt` : "Keine Gegenpartei erkennbar",
  };
}

function istAusgabenGruppe(group: string | undefined): boolean {
  return group === "fix" || group === "variabel" || group === "freiwillig";
}

/**
 * Geldeingang von einem Händler, bei dem man sonst bezahlt.
 *
 * Bewusst unter der Nachfrage-Schwelle: eine Rückerstattung sollte mit der
 * ursprünglichen Ausgabe verrechnet werden, und diese Zuordnung kann nur der
 * Nutzer bestätigen.
 */
function rueckerstattung(name: string): CategorySuggestion {
  return {
    categorySlug: "erstattung",
    confidence: 0.6,
    stage: "regel",
    treatment: "neutral",
    reason: `Geldeingang von "${name}" — vermutlich Rückerstattung oder Retoure`,
  };
}

/**
 * Senkt die Konfidenz, wenn der Betrag stark vom gelernten Muster abweicht.
 *
 * Schützt vor der Falle "gleiche Gegenpartei, anderer Zweck": 488 Franken an
 * den Vermieter sind Miete, 43 Franken an dieselbe Person sind es nicht.
 */
function withAmountCheck(
  suggestion: CategorySuggestion,
  entry: MemoryEntry,
  amount: number,
  name: string,
  isExpense: boolean,
): CategorySuggestion {
  // Rückerstattung schlägt auch das Gedächtnis.
  const cat = CATEGORY_BY_SLUG.get(entry.categorySlug);
  if (!isExpense && istAusgabenGruppe(cat?.group) && entry.treatment !== "neutral") {
    return rueckerstattung(name);
  }

  if (!entry.typicalAmount) return suggestion;

  const betrag = Math.abs(amount);
  const typisch = Math.abs(entry.typicalAmount);
  if (typisch === 0) return suggestion;

  const abweichung = Math.abs(betrag - typisch) / typisch;
  if (abweichung <= 0.4) return suggestion;

  // Deutlich anderer Betrag: nachfragen statt raten.
  return {
    ...suggestion,
    confidence: Math.min(suggestion.confidence, 0.5),
    reason:
      `${suggestion.reason} — aber der Betrag weicht stark vom üblichen ab ` +
      `(sonst rund ${(typisch / 100).toFixed(2)}). Bitte prüfen.`,
  };
}

/** Braucht diese Buchung eine Rückfrage? */
export function needsReview(
  suggestion: CategorySuggestion,
  threshold = DEFAULT_REVIEW_THRESHOLD,
): boolean {
  return suggestion.categorySlug === null || suggestion.confidence < threshold;
}

/**
 * Leitet aus bereits zugeordneten Buchungen neue Gedächtniseinträge ab.
 *
 * Damit lernt das System auch aus der Vergangenheit: sind vier von fünf
 * Besuchen bei einem Händler derselben Kategorie zugeordnet, wird das zur
 * Regel für künftige Buchungen. Der Schwellenwert verhindert, dass ein
 * einzelner Ausrutscher zur Regel wird.
 */
export function lerneAusHistorie(
  zugeordnet: Array<{
    counterparty?: string;
    categorySlug: string;
    treatment?: Treatment;
    amount?: number;
  }>,
  opts: { minVorkommen?: number; minAnteil?: number } = {},
): Map<string, MemoryEntry> {
  const { minVorkommen = 2, minAnteil = 0.7 } = opts;
  const memory = new Map<string, MemoryEntry>();

  const zaehle = (
    schluessel: (name: string) => string,
    kind: "exakt" | "marke",
  ) => {
    const buckets = new Map<string, Map<string, number>>();
    const treatments = new Map<string, Treatment | undefined>();
    const betraege = new Map<string, number[]>();

    for (const t of zugeordnet) {
      if (!t.counterparty || !t.categorySlug) continue;
      const k = schluessel(t.counterparty);
      if (!k) continue;
      const inner = buckets.get(k) ?? new Map<string, number>();
      inner.set(t.categorySlug, (inner.get(t.categorySlug) ?? 0) + 1);
      buckets.set(k, inner);
      if (t.treatment) treatments.set(`${k}|${t.categorySlug}`, t.treatment);
      if (t.amount !== undefined) {
        const liste = betraege.get(`${k}|${t.categorySlug}`) ?? [];
        liste.push(Math.abs(t.amount));
        betraege.set(`${k}|${t.categorySlug}`, liste);
      }
    }

    for (const [k, inner] of buckets) {
      const total = [...inner.values()].reduce((a, b) => a + b, 0);
      if (total < minVorkommen) continue;

      const [bestSlug, bestCount] = [...inner.entries()].sort((a, b) => b[1] - a[1])[0];
      if (bestCount / total < minAnteil) continue; // zu uneinheitlich

      memory.set(memoryKey(kind, k), {
        categorySlug: bestSlug,
        treatment: treatments.get(`${k}|${bestSlug}`),
        confirmations: bestCount,
        manual: false,
        typicalAmount: stabilerBetrag(betraege.get(`${k}|${bestSlug}`) ?? []),
      });
    }
  };

  zaehle(merchantKey, "exakt");
  zaehle(brandKey, "marke");
  return memory;
}

/**
 * Liefert den typischen Betrag — aber nur, wenn er wirklich stabil ist.
 *
 * Bei einem Dauerauftrag über 488 Franken ist er aussagekräftig. Beim
 * Einkaufen schwanken die Beträge naturgemäss, dort wäre eine Betragsprüfung
 * nur störend und liefert deshalb bewusst nichts zurück.
 */
function stabilerBetrag(betraege: number[]): number | undefined {
  if (betraege.length < 3) return undefined;
  const m = median(betraege);
  if (m === 0) return undefined;
  const nahAmMedian = betraege.filter((b) => Math.abs(b - m) / m <= 0.2).length;
  return nahAmMedian / betraege.length >= 0.8 ? m : undefined;
}
