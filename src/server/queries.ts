import { getSqlite } from "@/db";
import { CATEGORY_BY_SLUG, CATEGORIES } from "@/core/categorize/categories";
import { median } from "@/core/money";
import type { Necessity } from "@/core/types";

/**
 * Auswertungen.
 *
 * Zwei Regeln gelten überall, sonst stimmen die Zahlen nicht:
 *
 * 1. NETTO STATT BRUTTO. Eine Ausgabe, die teilweise zurückerstattet wurde,
 *    zählt nur mit dem Rest. Die Rückzahlung selbst taucht nirgends als
 *    Einnahme auf — sonst wäre sie doppelt drin.
 *
 * 2. NEUTRALES BLEIBT DRAUSSEN. Eigenüberträge, Investments und der
 *    Kreditkarten-Ausgleich sind keine Ausgaben. Ohne diese Trennung würde
 *    ein einzelner Monat mit einer Umschichtung jede Statistik zerstören.
 */

/**
 * Gemeinsamer SQL-Ausdruck für den bereinigten Betrag.
 *
 * Rechnet Rückzahlungen gegen die Ausgabe auf und kappt bei null: kommt mehr
 * zurück als ausgegeben wurde, ist die Ausgabe eben null und wird nicht zum
 * Gewinn.
 */
const NETTO = `
  CASE
    WHEN t.amount < 0 THEN
      MIN(0, t.amount + COALESCE((
        SELECT SUM(o.amount) FROM transactions o WHERE o.offset_of = t.id
      ), 0))
    ELSE t.amount
  END
`;

/** Buchungen, die als Verrechnung an einer anderen hängen, zählen nicht doppelt. */
const NUR_HAUPTBUCHUNGEN = `t.offset_of IS NULL`;

export interface KategorieSumme {
  slug: string;
  label: string;
  icon: string;
  necessity: Necessity;
  gruppe: string;
  betrag: number; // Rappen, negativ
  anzahl: number;
}

export interface MonatsUebersicht {
  monat: string;
  ausgaben: number;
  einnahmen: number;
  saldo: number;
  nachNotwendigkeit: Record<Necessity, number>;
  kategorien: KategorieSumme[];
  offeneAnzahl: number;
  neutralSumme: number;
}

/** Ermittelt die Notwendigkeit einer Buchung, inklusive Einzelfall-Abweichung. */
function notwendigkeit(slug: string | null, override: string | null): Necessity {
  if (override) return override as Necessity;
  if (!slug) return "freiwillig";
  return CATEGORY_BY_SLUG.get(slug)?.necessity ?? "freiwillig";
}

export function monatsUebersicht(monat: string): MonatsUebersicht {
  const db = getSqlite();

  const zeilen = db
    .prepare(
      `SELECT t.category_slug AS slug, t.necessity_override AS override,
              SUM(${NETTO}) AS betrag, COUNT(*) AS anzahl, t.treatment AS treatment
       FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND substr(t.booking_date, 1, 7) = ?
       GROUP BY t.category_slug, t.necessity_override, t.treatment`,
    )
    .all(monat) as Array<{
    slug: string | null;
    override: string | null;
    betrag: number;
    anzahl: number;
    treatment: string;
  }>;

  const kategorien = new Map<string, KategorieSumme>();
  const nachNotwendigkeit: Record<Necessity, number> = {
    fix: 0, noetig: 0, freiwillig: 0, neutral: 0,
  };
  let ausgaben = 0;
  let einnahmen = 0;
  let neutralSumme = 0;

  for (const z of zeilen) {
    if (z.treatment !== "normal") {
      neutralSumme += z.betrag;
      continue;
    }

    const slug = z.slug ?? "sonstiges";
    const def = CATEGORY_BY_SLUG.get(slug);
    const ist = notwendigkeit(z.slug, z.override);

    if (def?.group === "einkommen" || z.betrag > 0) {
      einnahmen += z.betrag;
    } else {
      ausgaben += z.betrag;
      nachNotwendigkeit[ist] += z.betrag;
    }

    const vorhanden = kategorien.get(slug);
    if (vorhanden) {
      vorhanden.betrag += z.betrag;
      vorhanden.anzahl += z.anzahl;
    } else {
      kategorien.set(slug, {
        slug,
        label: def?.label ?? slug,
        icon: def?.icon ?? "•",
        necessity: ist,
        gruppe: def?.group ?? "freiwillig",
        betrag: z.betrag,
        anzahl: z.anzahl,
      });
    }
  }

  const offen = db
    .prepare(
      `SELECT COUNT(*) n FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND substr(t.booking_date,1,7) = ?
         AND t.reviewed = 0 AND (t.category_slug IS NULL OR t.confidence < 0.75)`,
    )
    .get(monat) as { n: number };

  return {
    monat,
    ausgaben,
    einnahmen,
    saldo: einnahmen + ausgaben,
    nachNotwendigkeit,
    kategorien: [...kategorien.values()].sort((a, b) => a.betrag - b.betrag),
    offeneAnzahl: offen.n,
    neutralSumme,
  };
}

export interface MonatsPunkt {
  monat: string;
  fix: number;
  noetig: number;
  freiwillig: number;
  einnahmen: number;
  ausgaben: number;
}

/** Verlauf über die letzten Monate — Grundlage für Trend und Budgetvorschlag. */
export function monatsReihe(): MonatsPunkt[] {
  const db = getSqlite();
  const zeilen = db
    .prepare(
      `SELECT substr(t.booking_date,1,7) AS monat, t.category_slug AS slug,
              t.necessity_override AS override, SUM(${NETTO}) AS betrag
       FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal'
       GROUP BY monat, t.category_slug, t.necessity_override
       ORDER BY monat`,
    )
    .all() as Array<{ monat: string; slug: string | null; override: string | null; betrag: number }>;

  const map = new Map<string, MonatsPunkt>();
  for (const z of zeilen) {
    const p = map.get(z.monat) ?? {
      monat: z.monat, fix: 0, noetig: 0, freiwillig: 0, einnahmen: 0, ausgaben: 0,
    };
    const def = CATEGORY_BY_SLUG.get(z.slug ?? "");
    if (def?.group === "einkommen" || z.betrag > 0) {
      p.einnahmen += z.betrag;
    } else {
      const ist = notwendigkeit(z.slug, z.override);
      // Als positive Beträge führen — Diagramme zeichnen Ausgaben nach oben.
      const betrag = Math.abs(z.betrag);
      if (ist === "fix") p.fix += betrag;
      else if (ist === "noetig") p.noetig += betrag;
      else if (ist === "freiwillig") p.freiwillig += betrag;
      p.ausgaben += betrag;
    }
    map.set(z.monat, p);
  }
  return [...map.values()].sort((a, b) => a.monat.localeCompare(b.monat));
}

export interface OffeneBuchung {
  id: number;
  bookingDate: string;
  amount: number;
  counterparty: string | null;
  rawText: string;
  place: string | null;
  categorySlug: string | null;
  confidence: number;
  reason: string | null;
  source: string;
  issuerCategory: string | null;
}

/**
 * Die Nachfrage-Liste.
 *
 * Sortiert nach Betrag, nicht nach Datum: eine Zuordnung über 500 Franken
 * verändert die Auswertung deutlich, eine über 3 Franken kaum. Wer nur fünf
 * Minuten Zeit hat, soll die wirksamen zuerst sehen.
 */
export function offeneBuchungen(limit = 200): OffeneBuchung[] {
  return getSqlite()
    .prepare(
      `SELECT t.id, t.booking_date AS bookingDate, ${NETTO} AS amount,
              t.counterparty, t.raw_text AS rawText, t.place,
              t.category_slug AS categorySlug, t.confidence, t.reason,
              t.source, t.issuer_category AS issuerCategory
       FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND t.reviewed = 0
         AND (t.category_slug IS NULL OR t.confidence < 0.75)
       ORDER BY ABS(${NETTO}) DESC
       LIMIT ?`,
    )
    .all(limit) as OffeneBuchung[];
}

/**
 * Findet Geldeingänge, für die noch keine Verrechnung festgelegt wurde.
 * Grundlage für die Vorschläge in der Nachfrage-Liste.
 */
export function offeneEingaenge(): OffeneBuchung[] {
  return getSqlite()
    .prepare(
      `SELECT t.id, t.booking_date AS bookingDate, t.amount,
              t.counterparty, t.raw_text AS rawText, t.place,
              t.category_slug AS categorySlug, t.confidence, t.reason,
              t.source, t.issuer_category AS issuerCategory
       FROM transactions t
       WHERE t.amount > 0 AND t.offset_of IS NULL AND t.treatment != 'neutral'
         AND (t.category_slug = 'erstattung' OR t.counterparty_phone IS NOT NULL)
         AND t.reviewed = 0
       ORDER BY t.booking_date DESC`,
    )
    .all() as OffeneBuchung[];
}

/** Ausgaben im Zeitfenster um ein Datum — Kandidaten für eine Verrechnung. */
export function ausgabenUm(datum: string, tage = 120) {
  return getSqlite()
    .prepare(
      `SELECT t.id, t.booking_date AS bookingDate, t.amount, t.counterparty,
              t.counterparty_phone AS counterpartyPhone, t.category_slug AS categorySlug
       FROM transactions t
       WHERE t.amount < 0 AND t.treatment = 'normal'
         AND t.booking_date <= ?
         AND julianday(?) - julianday(t.booking_date) <= ?
       ORDER BY t.booking_date DESC`,
    )
    .all(datum, datum, tage) as Array<{
    id: number; bookingDate: string; amount: number;
    counterparty: string | null; counterpartyPhone: string | null; categorySlug: string | null;
  }>;
}

export interface HaendlerSumme {
  counterparty: string;
  anzahl: number;
  betrag: number;
  kategorie: string | null;
}

export function topHaendler(monat: string | null, limit = 12): HaendlerSumme[] {
  const db = getSqlite();
  const filter = monat ? "AND substr(t.booking_date,1,7) = ?" : "";
  const args = monat ? [monat, limit] : [limit];
  return db
    .prepare(
      `SELECT t.counterparty, COUNT(*) AS anzahl, SUM(${NETTO}) AS betrag,
              MAX(t.category_slug) AS kategorie
       FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal' AND t.amount < 0
         AND t.counterparty IS NOT NULL ${filter}
       GROUP BY t.counterparty
       ORDER BY betrag ASC
       LIMIT ?`,
    )
    .all(...args) as HaendlerSumme[];
}

export interface WiederkehrenderPosten {
  counterparty: string;
  categorySlug: string | null;
  typischerBetrag: number;
  anzahl: number;
  monate: string[];
  intervallTage: number;
  zuletzt: string;
  naechstErwartet: string;
}

/**
 * Erkennt wiederkehrende Belastungen aus dem Zahlungsmuster.
 *
 * Wichtig für die Prognose: die Semestergebühr kommt zweimal im Jahr. Ein
 * Modell, das nur Monatsdurchschnitte kennt, verteilt sie entweder falsch auf
 * alle Monate oder übersieht sie ganz.
 */
export function erkenneWiederkehrend(minVorkommen = 3): WiederkehrenderPosten[] {
  const db = getSqlite();
  const zeilen = db
    .prepare(
      `SELECT t.counterparty, t.booking_date AS datum, t.amount,
              t.category_slug AS categorySlug
       FROM transactions t
       WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal' AND t.amount < 0
         AND t.counterparty IS NOT NULL
       ORDER BY t.counterparty, t.booking_date`,
    )
    .all() as Array<{ counterparty: string; datum: string; amount: number; categorySlug: string | null }>;

  const nachHaendler = new Map<string, typeof zeilen>();
  for (const z of zeilen) {
    const liste = nachHaendler.get(z.counterparty) ?? [];
    liste.push(z);
    nachHaendler.set(z.counterparty, liste);
  }

  const ergebnis: WiederkehrenderPosten[] = [];

  for (const [counterparty, liste] of nachHaendler) {
    if (liste.length < minVorkommen) continue;

    // Abstände zwischen aufeinanderfolgenden Zahlungen.
    const abstaende: number[] = [];
    for (let i = 1; i < liste.length; i++) {
      const t = Math.round(
        (new Date(liste[i].datum).getTime() - new Date(liste[i - 1].datum).getTime()) / 86_400_000,
      );
      if (t > 0) abstaende.push(t);
    }
    if (abstaende.length < minVorkommen - 1) continue;

    const intervall = median(abstaende);

    /*
     * Nur monatlich oder seltener.
     *
     * Kürzere Abstände sind keine Daueraufträge, sondern Gewohnheiten: sechs
     * Besuche im selben Coop zu je drei Franken sehen rechnerisch wie ein
     * zweiwöchentlicher Rhythmus aus, sind aber nichts, was man planen könnte.
     */
    if (intervall < 25 || intervall > 400) continue;

    /*
     * Gleicher Tag im Monat.
     *
     * Das ist das eigentliche Unterscheidungsmerkmal. Miete und Abos werden
     * immer am selben Stichtag belastet, ein Ladenbesuch fällt auf zufällige
     * Tage. Ohne diese Prüfung landen Einkaufsgewohnheiten in der Fixkostenliste.
     */
    const tage = liste.map((z) => new Date(z.datum).getDate());
    const mittlererTag = median(tage);
    const amGleichenTag = tage.filter((t) => {
      const abstand = Math.abs(t - mittlererTag);
      // Monatsenden umlaufen: der 31. und der 1. liegen nah beieinander.
      return Math.min(abstand, 31 - abstand) <= 4;
    }).length;
    if (amGleichenTag / tage.length < 0.7) continue;

    // Kleinbeträge sind als planbare Belastung ohne Aussage.
    if (Math.abs(median(liste.map((z) => z.amount))) < 1000) continue;

    // Die Abstände müssen einigermassen regelmässig sein, sonst ist es kein
    // Dauerauftrag, sondern nur ein häufig besuchter Laden.
    const regelmaessig =
      abstaende.filter((a) => Math.abs(a - intervall) / intervall <= 0.35).length /
      abstaende.length;
    if (regelmaessig < 0.6) continue;

    const betraege = liste.map((z) => z.amount);
    const typisch = median(betraege);
    const betragStabil =
      betraege.filter((b) => Math.abs(Math.abs(b) - Math.abs(typisch)) / Math.abs(typisch) <= 0.25)
        .length / betraege.length;
    if (betragStabil < 0.6) continue;

    const zuletzt = liste[liste.length - 1].datum;
    const naechst = new Date(zuletzt);
    naechst.setDate(naechst.getDate() + intervall);

    ergebnis.push({
      counterparty,
      categorySlug: liste[liste.length - 1].categorySlug,
      typischerBetrag: typisch,
      anzahl: liste.length,
      monate: [...new Set(liste.map((z) => z.datum.slice(0, 7)))],
      intervallTage: intervall,
      zuletzt,
      naechstErwartet: naechst.toISOString().slice(0, 10),
    });
  }

  return ergebnis.sort((a, b) => a.typischerBetrag - b.typischerBetrag);
}

/** Alle Monate, für die Daten vorliegen — für die Monatsauswahl im UI. */
export function verfuegbareMonate(): string[] {
  return (
    getSqlite()
      .prepare(
        `SELECT DISTINCT substr(booking_date,1,7) AS m FROM transactions ORDER BY m DESC`,
      )
      .all() as Array<{ m: string }>
  ).map((r) => r.m);
}

export function anzahlBuchungen(): number {
  return (getSqlite().prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n;
}
