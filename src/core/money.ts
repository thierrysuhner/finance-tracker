/**
 * Geldbeträge werden durchgängig als ganzzahlige Rappen geführt.
 *
 * Grund: 0.1 + 0.2 !== 0.3 in Fliesskomma. Bei 322 Buchungen im Jahr summieren
 * sich solche Fehler zu sichtbaren Rappen-Differenzen, und ausgerechnet der
 * Abgleich "Kartenabrechnung = Summe der Kartenbuchungen" würde dann nie exakt
 * aufgehen. Mit Ganzzahlen ist er auf den Rappen genau.
 *
 * Vorzeichen-Konvention im ganzen Projekt:
 *   negativ = Geld fliesst raus (Ausgabe)
 *   positiv = Geld fliesst rein (Einnahme, Rückerstattung)
 */

/** Wandelt einen Betragsstring in Rappen. Versteht 1'234.56, 1,234.56, 1234.56, -58.80 */
export function parseAmountToRappen(raw: string): number {
  const s = raw.trim();
  if (!s) throw new Error("Leerer Betrag");

  const negative = s.startsWith("-");
  let body = s.replace(/^[+-]/, "");

  // Tausendertrennzeichen entfernen: Apostroph (CH) oder Komma/Punkt vor
  // exakt drei Ziffern, die nicht am Ende stehen.
  body = body.replace(/'/g, "");
  body = body.replace(/[,.](?=\d{3}(?:[.,]|$))/g, "");
  // Verbleibendes Komma ist das Dezimaltrennzeichen.
  body = body.replace(",", ".");

  if (!/^\d+(\.\d*)?$/.test(body)) {
    throw new Error(`Betrag nicht lesbar: ${raw}`);
  }

  const [whole, frac = ""] = body.split(".");
  const rappen =
    Number(whole) * 100 + Number((frac + "00").slice(0, 2).padEnd(2, "0"));

  return negative ? -rappen : rappen;
}

/** Formatiert Rappen als CHF-String, z.B. 187415 -> "1'874.15" */
export function formatRappen(
  rappen: number,
  opts: { sign?: boolean; decimals?: boolean } = {},
): string {
  const { sign = false, decimals = true } = opts;
  const negative = rappen < 0;
  const abs = Math.abs(rappen);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const body = decimals
    ? `${grouped}.${String(frac).padStart(2, "0")}`
    : grouped;

  if (sign) return `${negative ? "−" : "+"}${body}`;
  return negative ? `−${body}` : body;
}

/** Rundet auf ganze Franken (fürs Dashboard, wo Rappen nur Lärm sind) */
export function toFrancs(rappen: number): number {
  return Math.round(rappen / 100);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Median statt Durchschnitt für Budgetvorschläge.
 *
 * Bewusste Entscheidung: ein einzelner Monat mit einer 17'000er-Umschichtung
 * oder einer Semesterrechnung verschiebt den Durchschnitt so stark, dass der
 * Budgetvorschlag unbrauchbar wird. Der Median ignoriert solche Ausreisser.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
