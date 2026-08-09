import { getSqlite } from "@/db";
import { median } from "@/core/money";
import { AUSGABEN_KATEGORIEN, CATEGORY_BY_SLUG } from "@/core/categorize/categories";
import { monatsReihe, erkenneWiederkehrend } from "./queries";
import type { Necessity } from "@/core/types";

/**
 * Budget und Prognose.
 *
 * Grundhaltung: Vorschläge aus den eigenen Zahlen sind besser als Vorgaben aus
 * dem Nichts. Das Tool schlägt vor, was du ohnehin ausgibst — die Entscheidung,
 * ob das so bleiben soll, liegt bei dir.
 */

export interface BudgetZeile {
  slug: string;
  label: string;
  icon: string;
  necessity: Necessity;
  /** Gesetztes Budget in Rappen (positiv), oder null wenn keines gesetzt ist. */
  budget: number | null;
  /** Vorschlag aus der Historie. */
  vorschlag: number;
  /** Bereits ausgegeben in diesem Monat (positiv). */
  ist: number;
  /** Hochrechnung aufs Monatsende (positiv). */
  hochrechnung: number;
  anzahlMonate: number;
}

/**
 * Budgetvorschlag je Kategorie.
 *
 * Median statt Durchschnitt und ohne den laufenden Monat: ein einzelner
 * Ausreisser — die Semestergebühr, eine Reise — würde den Durchschnitt so
 * verschieben, dass der Vorschlag unbrauchbar wird.
 */
export function budgetVorschlaege(): Map<string, { betrag: number; monate: number }> {
  const db = getSqlite();
  const aktuellerMonat = new Date().toISOString().slice(0, 7);

  const zeilen = db
    .prepare(
      `SELECT substr(t.booking_date,1,7) AS monat, t.category_slug AS slug,
              SUM(CASE
                WHEN t.amount < 0 THEN MIN(0, t.amount + COALESCE((
                  SELECT SUM(o.amount) FROM transactions o WHERE o.offset_of = t.id), 0))
                ELSE 0 END) AS betrag
       FROM transactions t
       WHERE t.offset_of IS NULL AND t.treatment = 'normal'
         AND t.amount < 0 AND t.category_slug IS NOT NULL
         AND substr(t.booking_date,1,7) < ?
       GROUP BY monat, t.category_slug`,
    )
    .all(aktuellerMonat) as Array<{ monat: string; slug: string; betrag: number }>;

  const proKategorie = new Map<string, number[]>();
  const monateGesamt = new Set<string>();
  for (const z of zeilen) {
    monateGesamt.add(z.monat);
    const liste = proKategorie.get(z.slug) ?? [];
    liste.push(Math.abs(z.betrag));
    proKategorie.set(z.slug, liste);
  }

  const ergebnis = new Map<string, { betrag: number; monate: number }>();
  for (const [slug, werte] of proKategorie) {
    // Monate ohne Ausgabe in dieser Kategorie zählen als Null — sonst
    // überschätzt der Median eine Kategorie, die nur selten vorkommt.
    const fehlend = monateGesamt.size - werte.length;
    const vollstaendig = [...werte, ...Array(Math.max(0, fehlend)).fill(0)];
    ergebnis.set(slug, { betrag: median(vollstaendig), monate: werte.length });
  }
  return ergebnis;
}

export function gesetzteBudgets(monat: string): Map<string, number> {
  const rows = getSqlite()
    .prepare(
      `SELECT category_slug AS slug, amount FROM budgets
       WHERE month = ? OR month IS NULL
       ORDER BY month IS NULL DESC`, // monatsspezifisch schlägt Standard
    )
    .all(monat) as Array<{ slug: string; amount: number }>;

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.slug, r.amount); // spätere überschreiben
  return map;
}

/**
 * Hochrechnung aufs Monatsende.
 *
 * Fixkosten werden NICHT hochgerechnet: die Miete kommt einmal, nicht anteilig
 * jeden Tag. Würde man sie linear hochrechnen, sagte die Prognose am 5. des
 * Monats das Sechsfache der Miete voraus.
 */
function hochrechnen(
  ist: number,
  necessity: Necessity,
  budget: number | null,
  tagImMonat: number,
  tageImMonat: number,
): number {
  if (necessity === "fix") {
    // Was noch nicht gebucht ist, kommt in voller Höhe — aber nie weniger
    // als bereits ausgegeben wurde.
    return Math.max(ist, budget ?? ist);
  }
  if (tagImMonat <= 0) return ist;
  return Math.round((ist / tagImMonat) * tageImMonat);
}

export function budgetVergleich(monat: string): BudgetZeile[] {
  const db = getSqlite();
  const vorschlaege = budgetVorschlaege();
  const gesetzt = gesetzteBudgets(monat);

  const istZeilen = db
    .prepare(
      `SELECT t.category_slug AS slug,
              SUM(CASE
                WHEN t.amount < 0 THEN MIN(0, t.amount + COALESCE((
                  SELECT SUM(o.amount) FROM transactions o WHERE o.offset_of = t.id), 0))
                ELSE 0 END) AS betrag
       FROM transactions t
       WHERE t.offset_of IS NULL AND t.treatment = 'normal' AND t.amount < 0
         AND substr(t.booking_date,1,7) = ?
       GROUP BY t.category_slug`,
    )
    .all(monat) as Array<{ slug: string | null; betrag: number }>;

  const ist = new Map<string, number>();
  for (const z of istZeilen) ist.set(z.slug ?? "sonstiges", Math.abs(z.betrag));

  // Wie weit ist der Monat fortgeschritten?
  const heute = new Date();
  const [jahr, mon] = monat.split("-").map(Number);
  const tageImMonat = new Date(jahr, mon, 0).getDate();
  const istAktuellerMonat = heute.toISOString().slice(0, 7) === monat;
  const tagImMonat = istAktuellerMonat ? heute.getDate() : tageImMonat;

  return AUSGABEN_KATEGORIEN.map((k) => {
    const v = vorschlaege.get(k.slug);
    const budget = gesetzt.get(k.slug) ?? null;
    const istBetrag = ist.get(k.slug) ?? 0;
    return {
      slug: k.slug,
      label: k.label,
      icon: k.icon,
      necessity: k.necessity,
      budget,
      vorschlag: v?.betrag ?? 0,
      ist: istBetrag,
      hochrechnung: hochrechnen(istBetrag, k.necessity, budget, tagImMonat, tageImMonat),
      anzahlMonate: v?.monate ?? 0,
    };
  })
    .filter((z) => z.ist > 0 || z.budget !== null || z.vorschlag > 0)
    .sort((a, b) => b.hochrechnung - a.hochrechnung);
}

export interface PrognosePunkt {
  monat: string;
  /** Erwartete Ausgaben in Rappen (positiv). */
  erwartet: number;
  fix: number;
  variabel: number;
  /** Einmalige, bereits absehbare Posten wie die Semestergebühr. */
  einmalig: Array<{ label: string; betrag: number }>;
  istWert: boolean;
}

/**
 * Prognose der kommenden Monate.
 *
 * Setzt sich zusammen aus: erkannten wiederkehrenden Posten mit ihrem echten
 * Rhythmus, plus dem typischen variablen Aufwand. Dadurch erscheint die
 * Semestergebühr im richtigen Monat statt als Zwölftel überall.
 */
export function prognose(anzahlMonate = 6): PrognosePunkt[] {
  const reihe = monatsReihe();
  const wiederkehrend = erkenneWiederkehrend();
  const heute = new Date();
  const aktuellerMonat = heute.toISOString().slice(0, 7);

  // Typischer variabler Aufwand aus abgeschlossenen Monaten.
  const abgeschlossen = reihe.filter((p) => p.monat < aktuellerMonat);
  const variabelTypisch = median(abgeschlossen.map((p) => p.noetig + p.freiwillig));
  const fixTypisch = median(abgeschlossen.map((p) => p.fix));

  /*
   * Nur Posten, die seltener als monatlich kommen UND spürbar ins Gewicht
   * fallen, werden gesondert eingeplant. Monatliches steckt bereits im
   * Median; und ein Betrag von zwei Franken als Planungsposten auszuweisen
   * wäre nur Rauschen in einer Prognose über Hunderte von Franken.
   */
  const unregelmaessig = wiederkehrend.filter(
    (w) => w.intervallTage > 45 && Math.abs(w.typischerBetrag) >= 5000,
  );

  const punkte: PrognosePunkt[] = [];
  for (let i = 0; i < anzahlMonate; i++) {
    const d = new Date(heute.getFullYear(), heute.getMonth() + i, 1);
    const monat = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const einmalig: Array<{ label: string; betrag: number }> = [];
    for (const w of unregelmaessig) {
      // Nächste erwartete Fälligkeiten in diesem Monat?
      let naechst = new Date(w.naechstErwartet);
      for (let k = 0; k < 12; k++) {
        if (naechst.toISOString().slice(0, 7) === monat) {
          einmalig.push({ label: w.counterparty, betrag: Math.abs(w.typischerBetrag) });
          break;
        }
        if (naechst.toISOString().slice(0, 7) > monat) break;
        naechst = new Date(naechst.getTime() + w.intervallTage * 86_400_000);
      }
    }

    const einmaligSumme = einmalig.reduce((a, e) => a + e.betrag, 0);
    punkte.push({
      monat,
      fix: fixTypisch,
      variabel: variabelTypisch,
      einmalig,
      erwartet: fixTypisch + variabelTypisch + einmaligSumme,
      istWert: false,
    });
  }
  return punkte;
}

/** Setzt oder entfernt ein Budget. */
export function setzeBudget(slug: string, betrag: number | null, monat: string | null = null): void {
  const db = getSqlite();
  if (betrag === null) {
    db.prepare(
      `DELETE FROM budgets WHERE category_slug = ? AND IFNULL(month,'') = IFNULL(?,'')`,
    ).run(slug, monat);
    return;
  }
  db.prepare(
    `INSERT INTO budgets (category_slug, month, amount, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(category_slug, IFNULL(month, '')) DO UPDATE SET
       amount = excluded.amount, updated_at = excluded.updated_at`,
  ).run(slug, monat, Math.abs(betrag), new Date().toISOString());
}

/** Übernimmt alle Vorschläge als Standardbudget — für die Ersteinrichtung. */
export function uebernehmeVorschlaege(): number {
  const v = budgetVorschlaege();
  let n = 0;
  for (const [slug, wert] of v) {
    if (wert.betrag <= 0) continue;
    if (!CATEGORY_BY_SLUG.has(slug)) continue;
    setzeBudget(slug, wert.betrag, null);
    n++;
  }
  return n;
}
