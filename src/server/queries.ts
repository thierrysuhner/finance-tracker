import { getDb } from "@/db";
import { CATEGORY_BY_SLUG } from "@/core/categorize/categories";
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

/** Kleinster Betrag je Belastung, der als Dauerauftrag durchgeht — in Rappen. */
export const MIN_DAUERAUFTRAG = 1400;

/** Kleinstes Monatsäquivalent, damit ein Posten fürs Planen zählt — in Rappen. */
export const MIN_MONATSAEQUIVALENT = 1400;

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

export async function monatsUebersicht(monat: string): Promise<MonatsUebersicht> {
  const db = await getDb();

  const zeilen = await db.all<{
    slug: string | null;
    override: string | null;
    betrag: number;
    anzahl: number;
    treatment: string;
  }>(
    `SELECT t.category_slug AS slug, t.necessity_override AS override,
            SUM(${NETTO}) AS betrag, COUNT(*) AS anzahl, t.treatment AS treatment
     FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND substr(t.booking_date, 1, 7) = ?
     GROUP BY t.category_slug, t.necessity_override, t.treatment`,
    [monat],
  );

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

  const offen = await db.get<{ n: number }>(
    `SELECT COUNT(*) n FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND substr(t.booking_date,1,7) = ?
       AND t.reviewed = 0 AND (t.category_slug IS NULL OR t.confidence < 0.75)`,
    [monat],
  );

  return {
    monat,
    ausgaben,
    einnahmen,
    saldo: einnahmen + ausgaben,
    nachNotwendigkeit,
    kategorien: [...kategorien.values()].sort((a, b) => a.betrag - b.betrag),
    offeneAnzahl: offen?.n ?? 0,
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
export async function monatsReihe(): Promise<MonatsPunkt[]> {
  const db = await getDb();
  const zeilen = await db.all<{
    monat: string; slug: string | null; override: string | null; betrag: number;
  }>(
    `SELECT substr(t.booking_date,1,7) AS monat, t.category_slug AS slug,
            t.necessity_override AS override, SUM(${NETTO}) AS betrag
     FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal'
     GROUP BY monat, t.category_slug, t.necessity_override
     ORDER BY monat`,
  );

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
export async function offeneBuchungen(limit = 200): Promise<OffeneBuchung[]> {
  const db = await getDb();
  return db.all<OffeneBuchung>(
    `SELECT t.id, t.booking_date AS bookingDate, ${NETTO} AS amount,
            t.counterparty, t.raw_text AS rawText, t.place,
            t.category_slug AS categorySlug, t.confidence, t.reason,
            t.source, t.issuer_category AS issuerCategory
     FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND t.reviewed = 0
       AND (t.category_slug IS NULL OR t.confidence < 0.75)
     ORDER BY ABS(${NETTO}) DESC
     LIMIT ?`,
    [limit],
  );
}

/**
 * Findet Geldeingänge, für die noch keine Verrechnung festgelegt wurde.
 * Grundlage für die Vorschläge in der Nachfrage-Liste.
 */
export async function offeneEingaenge(): Promise<OffeneBuchung[]> {
  const db = await getDb();
  return db.all<OffeneBuchung>(
    `SELECT t.id, t.booking_date AS bookingDate, t.amount,
            t.counterparty, t.raw_text AS rawText, t.place,
            t.category_slug AS categorySlug, t.confidence, t.reason,
            t.source, t.issuer_category AS issuerCategory
     FROM transactions t
     WHERE t.amount > 0 AND t.offset_of IS NULL AND t.treatment != 'neutral'
       AND (t.category_slug = 'erstattung' OR t.counterparty_phone IS NOT NULL)
       AND t.reviewed = 0
     ORDER BY t.booking_date DESC`,
  );
}

/** Ausgaben im Zeitfenster um ein Datum — Kandidaten für eine Verrechnung. */
export async function ausgabenUm(datum: string, tage = 120) {
  const db = await getDb();
  return db.all<{
    id: number; bookingDate: string; amount: number;
    counterparty: string | null; counterpartyPhone: string | null; categorySlug: string | null;
  }>(
    `SELECT t.id, t.booking_date AS bookingDate, t.amount, t.counterparty,
            t.counterparty_phone AS counterpartyPhone, t.category_slug AS categorySlug
     FROM transactions t
     WHERE t.amount < 0 AND t.treatment = 'normal'
       AND t.booking_date <= ?
       AND julianday(?) - julianday(t.booking_date) <= ?
     ORDER BY t.booking_date DESC`,
    [datum, datum, tage],
  );
}

export interface HaendlerSumme {
  counterparty: string;
  anzahl: number;
  betrag: number;
  kategorie: string | null;
}

export async function topHaendler(monat: string | null, limit = 12): Promise<HaendlerSumme[]> {
  const db = await getDb();
  const filter = monat ? "AND substr(t.booking_date,1,7) = ?" : "";
  const args = monat ? [monat, limit] : [limit];
  return db.all<HaendlerSumme>(
    `SELECT t.counterparty, COUNT(*) AS anzahl, SUM(${NETTO}) AS betrag,
            MAX(t.category_slug) AS kategorie
     FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal' AND t.amount < 0
       AND t.counterparty IS NOT NULL ${filter}
     GROUP BY t.counterparty
     ORDER BY betrag ASC
     LIMIT ?`,
    args,
  );
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
export async function erkenneWiederkehrend(minVorkommen = 3): Promise<WiederkehrenderPosten[]> {
  const db = await getDb();
  const zeilen = await db.all<{
    counterparty: string; datum: string; amount: number; categorySlug: string | null;
  }>(
    `SELECT t.counterparty, t.booking_date AS datum, t.amount,
            t.category_slug AS categorySlug
     FROM transactions t
     WHERE ${NUR_HAUPTBUCHUNGEN} AND t.treatment = 'normal' AND t.amount < 0
       AND t.counterparty IS NOT NULL
     ORDER BY t.counterparty, t.booking_date`,
  );

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
     * Besuche im selben Laden zu je drei Franken sehen rechnerisch wie ein
     * zweiwöchentlicher Rhythmus aus, sind aber nichts, was man planen könnte.
     */
    if (intervall < 25 || intervall > 400) continue;

    /*
     * Gleicher Tag im Monat — aber NUR bei monatlichem Rhythmus.
     *
     * Bei Monatsbeträgen ist das das entscheidende Unterscheidungsmerkmal:
     * Miete und Abos treffen den Stichtag, ein Ladenbesuch fällt auf
     * zufällige Tage.
     *
     * Bei längeren Abständen wäre die Prüfung dagegen schädlich. Eine
     * Semestergebühr ist eine Rechnung mit Zahlungsfrist, kein Dauerauftrag —
     * sie wird mal am 17., mal am 27. bezahlt. Dort trägt die Regelmässigkeit
     * des Abstands die Aussage: alle 170 Tage derselbe Betrag ist kein
     * Einkaufsverhalten.
     */
    if (intervall <= 45) {
      const tage = liste.map((z) => new Date(z.datum).getDate());
      const mittlererTag = median(tage);
      const amGleichenTag = tage.filter((t) => {
        const abstand = Math.abs(t - mittlererTag);
        // Monatsenden umlaufen: der 31. und der 1. liegen nah beieinander.
        return Math.min(abstand, 31 - abstand) <= 4;
      }).length;
      if (amGleichenTag / tage.length < 0.7) continue;
    }

    const betraege = liste.map((z) => z.amount);
    const typisch = median(betraege);
    const hoehe = Math.abs(typisch);

    /*
     * Zwei Untergrenzen, beide müssen erfüllt sein.
     *
     * 1. Je Belastung mindestens 14 Franken. Darunter gibt es schlicht keine
     *    Daueraufträge.
     *
     * 2. Aufs Monat gerechnet ebenfalls mindestens 14 Franken. Diese zweite
     *    Hürde ist nötig, weil ein Restaurant mit festem Menüpreis, das man
     *    alle drei Monate besucht, rechnerisch exakt wie ein Abo aussieht:
     *    gleicher Betrag, regelmässiger Abstand. Unterscheiden lässt es sich
     *    nur über die Frage, ob der Posten fürs Planen überhaupt zählt.
     */
    if (hoehe < MIN_DAUERAUFTRAG) continue;
    if ((hoehe * 30) / intervall < MIN_MONATSAEQUIVALENT) continue;

    // Die Abstände müssen einigermassen regelmässig sein, sonst ist es kein
    // Dauerauftrag, sondern nur ein häufig besuchter Laden.
    const regelmaessig =
      abstaende.filter((a) => Math.abs(a - intervall) / intervall <= 0.35).length /
      abstaende.length;
    if (regelmaessig < 0.6) continue;

    const betragStabil =
      betraege.filter((b) => Math.abs(Math.abs(b) - hoehe) / hoehe <= 0.25).length /
      betraege.length;
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
export async function verfuegbareMonate(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ m: string }>(
    `SELECT DISTINCT substr(booking_date,1,7) AS m FROM transactions ORDER BY m DESC`,
  );
  return rows.map((r) => r.m);
}

export async function anzahlBuchungen(): Promise<number> {
  const db = await getDb();
  const r = await db.get<{ n: number }>("SELECT COUNT(*) n FROM transactions");
  return r?.n ?? 0;
}
