import { merchantKey } from "../parsers/party";

/**
 * Zuordnung von Geldeingängen zu der Ausgabe, die sie ausgleichen.
 *
 * Drei Fälle, ein Mechanismus:
 *
 *   Geteilte Rechnung  Du zahlst 60 im Restaurant, ein Kollege überweist dir
 *                      40 zurück. Deine Ausgabe war real 20.
 *   Retoure            Du bestellst Kleider für 366, schickst sie zurück und
 *                      bekommst 357 gutgeschrieben.
 *   Kaution            Du hinterlegst 1'874 und bekommst sie später zurück.
 *                      War nie eine Ausgabe, sondern eine Forderung.
 *
 * Ohne diese Verrechnung stimmt keine Monatsstatistik: im Beispiel der echten
 * Kartendaten ist der März netto negativ, weil Februar-Retouren eintrudeln.
 *
 * Bewusste Entscheidung: die Zuordnung wird nur VORGESCHLAGEN. Automatisch
 * verrechnen wäre gefährlich — ein Kollege, der 40 Franken überweist, kann
 * genauso gut eine alte Schuld begleichen.
 */

export interface OffsetKandidat {
  /** Die Ausgabe, die ausgeglichen werden könnte. */
  ausgabeId: number;
  /** Punktzahl 0..1, höher ist plausibler. */
  score: number;
  /** Begründung fürs UI. */
  grund: string;
}

export interface OffsetInput {
  id: number;
  bookingDate: string;
  amount: number;
  counterparty?: string | null;
  counterpartyPhone?: string | null;
  categorySlug?: string | null;
}

function tageDazwischen(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Ähnlichkeit zweier Gegenparteinamen, 0 bis 1.
 *
 * Muss mit zwei realen Schreibweisen umgehen:
 *
 *   "Lukas Maximilian Kapferer" gegen "Lukas Kapferer"
 *       Dieselbe Person, einmal mit zweitem Vornamen. Über gemeinsame
 *       Namensteile erkannt.
 *
 *   "WEFASHION.CH" gegen "WE Fashion"
 *       Derselbe Händler, einmal als Domain. Über Teilzeichenketten erkannt.
 *
 * Ein einzelner gemeinsamer Nachname genügt bewusst NICHT: Familienmitglieder
 * teilen ihn, und "Felix Suhner" ist nicht "Thierry Suhner".
 */
export function namensAehnlichkeit(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const kompaktA = a.replace(/\s/g, "");
  const kompaktB = b.replace(/\s/g, "");
  if (kompaktA.length >= 5 && kompaktB.length >= 5) {
    if (kompaktA.includes(kompaktB) || kompaktB.includes(kompaktA)) return 0.85;
  }

  const teileA = new Set(a.split(" ").filter((t) => t.length > 2));
  const teileB = new Set(b.split(" ").filter((t) => t.length > 2));
  if (teileA.size === 0 || teileB.size === 0) return 0;

  let gemeinsam = 0;
  for (const t of teileA) if (teileB.has(t)) gemeinsam++;
  if (gemeinsam < 2) return gemeinsam === 1 ? 0.4 : 0;

  return gemeinsam / Math.min(teileA.size, teileB.size);
}

/**
 * Sucht zu einem Geldeingang die passende Ausgabe.
 *
 * @param eingang      Die Gutschrift, für die ein Gegenstück gesucht wird.
 * @param kandidaten   Ausgaben aus dem umliegenden Zeitraum.
 */
export function findeOffsetKandidaten(
  eingang: OffsetInput,
  kandidaten: OffsetInput[],
  opts: { maxTage?: number; minScore?: number } = {},
): OffsetKandidat[] {
  const { maxTage = 120, minScore = 0.35 } = opts;
  if (eingang.amount <= 0) return [];

  const eingangBetrag = eingang.amount;
  const eingangPerson = eingang.counterparty ? merchantKey(eingang.counterparty) : "";
  const treffer: OffsetKandidat[] = [];

  for (const k of kandidaten) {
    if (k.amount >= 0) continue; // nur Ausgaben kommen als Gegenstück infrage
    if (k.id === eingang.id) continue;

    const tage = tageDazwischen(k.bookingDate, eingang.bookingDate);
    // Die Rückzahlung muss nach der Ausgabe kommen.
    if (tage < 0 || tage > maxTage) continue;

    const ausgabeBetrag = Math.abs(k.amount);
    if (eingangBetrag > ausgabeBetrag * 1.02) continue; // mehr zurück als raus: unplausibel

    const kandidatPerson = k.counterparty ? merchantKey(k.counterparty) : "";
    const namensBezug = namensAehnlichkeit(eingangPerson, kandidatPerson);

    /*
     * DIE ENTSCHEIDENDE HÜRDE.
     *
     * Ohne Namensbezug wird nur vorgeschlagen, wenn der Betrag exakt
     * übereinstimmt. Andernfalls entsteht Rauschen: eine Zahlung von 400
     * Franken der Eltern liesse sich rein rechnerisch gegen eine Miete von
     * 488 Franken acht Tage zuvor "verrechnen" — inhaltlich ist das Unsinn,
     * und ein falscher Vorschlag ist schlimmer als gar keiner, weil er zum
     * Wegklicken einlädt.
     */
    const exakterBetrag = eingangBetrag === ausgabeBetrag;
    if (namensBezug < 0.6 && !exakterBetrag) continue;

    /*
     * Ohne Namensbezug zusätzlich ein enges Zeitfenster. Über vier Monate
     * hinweg trifft irgendein Betrag irgendwann zufällig genau — zwei
     * Zwanzignoten haben nichts miteinander zu tun, nur weil beide 20 sind.
     * Innerhalb eines Monats ist die Gleichheit dagegen ein echtes Indiz.
     */
    if (namensBezug < 0.6 && tage > 31) continue;

    let score = 0;
    const gruende: string[] = [];

    // ── Betrag ───────────────────────────────────────────────────────────
    const anteil = eingangBetrag / ausgabeBetrag;
    if (eingangBetrag === ausgabeBetrag) {
      score += 0.5;
      gruende.push("Betrag stimmt exakt überein");
    } else if (anteil > 0.9) {
      score += 0.4;
      gruende.push("fast der volle Betrag");
    } else if (anteil >= 0.2) {
      // Typischer Anteil beim Teilen einer Rechnung.
      score += 0.25;
      gruende.push(`entspricht ${Math.round(anteil * 100)}% der Ausgabe`);
    } else {
      score += 0.05;
    }

    // ── Zeitlicher Abstand ───────────────────────────────────────────────
    if (tage <= 3) {
      score += 0.3;
      gruende.push(tage === 0 ? "gleicher Tag" : `${tage} Tage später`);
    } else if (tage <= 14) {
      score += 0.2;
      gruende.push(`${tage} Tage später`);
    } else if (tage <= 45) {
      score += 0.1;
      gruende.push(`${tage} Tage später`);
    } else {
      gruende.push(`${tage} Tage später`);
    }

    // ── Gegenpartei ──────────────────────────────────────────────────────
    // Bei identischer Schreibweise darf die Meldung bestimmt auftreten. Ist
    // der Name nur sehr ähnlich, wird das gesagt — sonst behauptet das UI
    // eine Gewissheit, die die Daten nicht hergeben.
    if (eingangPerson && eingangPerson === kandidatPerson) {
      score += 0.4;
      gruende.unshift("dieselbe Gegenpartei");
    } else if (namensBezug >= 0.6) {
      score += 0.3;
      gruende.unshift(`sehr ähnlicher Name (${k.counterparty})`);
    }

    if (score < minScore) continue;
    treffer.push({
      ausgabeId: k.id,
      score: Math.min(score, 1),
      grund: gruende.join(", "),
    });
  }

  return treffer.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Der um Rückzahlungen bereinigte Betrag einer Ausgabe.
 *
 * Beispiel: 60 Franken Restaurant, 40 zurück von zwei Kollegen -> −20.
 * Kommt mehr zurück als ausgegeben wurde, wird bei 0 gekappt statt ein
 * Guthaben auszuweisen.
 */
export function nettoBetrag(ausgabe: number, rueckzahlungen: number[]): number {
  const zurueck = rueckzahlungen.reduce((a, b) => a + Math.abs(b), 0);
  const netto = Math.abs(ausgabe) - zurueck;
  return netto <= 0 ? 0 : -netto;
}
