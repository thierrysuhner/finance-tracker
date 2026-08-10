/**
 * Extraktion von Gegenpartei, Uhrzeit und Ort aus den Freitextfeldern
 * eines Bankauszugs.
 *
 * Warum das nötig ist: In einem CAMT.053 der Hypothekarbank Lenzburg haben nur
 * rund 20% der Buchungen strukturierte Gegenparteidaten (<Cdtr>, <IBAN>).
 * Alle Karten- und TWINT-Zahlungen — also die grosse Mehrheit — liefern
 * ausschliesslich <AddtlNtryInf> als mehrzeiligen Fliesstext:
 *
 *   "17:35 Uhr, Migros Mr Gastronomie\n9200 Gossau SG"
 *   "00:49 Uhr, Kapferer, Lukas\n+41784411837"
 *   "Herr\nThierry Suhner\nUnterer Erlenhoelzliweg 2\n5616 Meisterschwanden"
 *
 * Ohne saubere Extraktion kann die Kategorisierung nichts lernen, weil derselbe
 * Händler bei jedem Besuch als anderer String erscheint.
 */

export interface ExtractedParty {
  name?: string;
  phone?: string;
  place?: string;
  time?: string;
  /** Deutet der Text auf eine Privatperson hin (TWINT mit Telefonnummer)? */
  isPerson: boolean;
}

/** Reine Banktexte ohne echte Gegenpartei. */
const GENERIC_TEXTS =
  /^(gutschrift|belastung|gebuehren|gebühren|zinsen|rueckverguetung|rückvergütung|vergütung|verguetung|ihre zahlung|zahlungseingang|dauerauftrag|lastschrift|storno)/i;

const SALUTATION = /^(herr|herrn|frau|familie|fam\.|an|mr|mrs|ms)\.?$/i;

/** Strassenbezeichner in DE/FR/IT/NL — decken die Adressen im Auszug ab. */
const STREET_WORDS =
  /(strasse|straße|str\.|-str\b|weg\b|gasse|platz|allee|ring\b|steig\b|halde|hoelzliweg|postfach|case postale|\bvia\b|\bviale\b|\brue\b|\bavenue\b|\bboulevard\b|straat|laan\b|street\b|road\b|\bst\.?\s*nr)/i;

/** "9000 St. Gallen", "81925 Muenchen", "CH-8810 HORGEN" */
const POSTAL_LINE = /^(?:[A-Z]{2}-)?\d{4,6}\s+\S/;

/** Reiner Ländercode auf eigener Zeile. */
const COUNTRY_ONLY = /^(CH|DE|AT|IT|FR|NL|GB|US|LI|ES|PT|BE|LU|DK|SE|NO|FI|PL|CZ)$/i;

const PHONE = /^\+?\d[\d\s/.-]{6,}$/;

/**
 * Zerlegt den Freitext einer Buchung.
 *
 * Vorgehen: Zeilen von hinten nach vorne als "Adressrauschen" verwerfen und
 * die erste verbleibende Zeile als Namen nehmen. Das funktioniert, weil in
 * allen beobachteten Formaten der Name zuerst steht.
 */
export function extractParty(rawText: string): ExtractedParty {
  const result: ExtractedParty = { isPerson: false };
  if (!rawText) return result;

  let lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (lines.length === 0) return result;

  // 1. Führende Uhrzeit abtrennen: "17:35 Uhr, Migros ..." -> time + Rest
  const timeMatch = lines[0].match(/^(\d{1,2}:\d{2})\s*Uhr,?\s*(.*)$/i);
  if (timeMatch) {
    result.time = timeMatch[1].padStart(5, "0");
    if (timeMatch[2]) lines[0] = timeMatch[2].trim();
    else lines.shift();
  }

  if (lines.length === 0) return result;

  // 2. Anrede-Zeilen entfernen ("Herr" / "Frau" stehen vor dem Namen)
  lines = lines.filter((l) => !SALUTATION.test(l));

  // 3. Telefonnummer, Ort und Adresse herausziehen
  const remaining: string[] = [];
  for (const line of lines) {
    if (PHONE.test(line)) {
      result.phone = line.replace(/[\s/.-]/g, "");
      result.isPerson = true;
      continue;
    }
    if (POSTAL_LINE.test(line)) {
      if (!result.place) result.place = line;
      continue;
    }
    if (COUNTRY_ONLY.test(line)) continue;
    if (STREET_WORDS.test(line) && /\d/.test(line)) {
      // Adresszeile mit Hausnummer — aber nur verwerfen, wenn schon ein
      // Namenskandidat existiert. Sonst wäre "Postfach" der einzige Rest.
      if (remaining.length > 0) continue;
    }
    remaining.push(line);
  }

  if (remaining.length === 0) return result;

  let name = remaining[0];

  // 4. Generische Banktexte sind keine Gegenpartei
  if (GENERIC_TEXTS.test(name)) {
    return { ...result, name: undefined };
  }

  // 5. "Nachname, Vorname" (TWINT-Konvention) in Leserichtung drehen
  const swapped = name.match(
    /^([A-ZÄÖÜ][\p{L}\-'’.]+(?:\s+[A-ZÄÖÜ][\p{L}\-'’.]+)?),\s+([A-ZÄÖÜ][\p{L}\s\-'’.]+)$/u,
  );
  if (swapped) {
    name = `${swapped[2].trim()} ${swapped[1].trim()}`;
    result.isPerson = true;
  }

  // Ort, der am Namen klebt, abschneiden: "Migros Mr Gastronomie 9200 Gossau"
  const trailingPlace = name.match(/^(.*?)\s+(\d{4,6}\s+[\p{L}\s.]+)$/u);
  if (trailingPlace && trailingPlace[1].length >= 3) {
    name = trailingPlace[1].trim();
    if (!result.place) result.place = trailingPlace[2].trim();
  }

  // Satzzeichen an den Rändern abräumen. Kommt vor, wenn TWINT nur einen
  // Vornamen liefert und das Feld als ", Norman" ankommt.
  result.name = name.replace(/^[,;\s.]+|[,;\s]+$/g, "").trim() || undefined;
  return result;
}

/**
 * Normalisierter Schlüssel für das Händler-Gedächtnis.
 *
 * Ziel: derselbe Händler soll über Monate hinweg denselben Schlüssel ergeben,
 * auch wenn Schreibweise, Umlaute oder Grossschreibung schwanken.
 */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Diakritika entfernen
    .replace(/[äàáâ]/g, "a")
    .replace(/[öòóô]/g, "o")
    .replace(/[üùúû]/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Marken-Schlüssel: reduziert Filialen auf die Marke, damit "Coop Wil",
 * "Coop-Zuerich Bahnhof" und "Coop Pronto 3658" gemeinsam gelernt werden.
 *
 * Bewusst konservativ: nur die ersten beiden Wörter, und Zahlen fliegen raus.
 * Zu aggressives Kürzen würde "Migros" und "Migrol" (Tankstelle) zusammenwerfen.
 */
export function brandKey(name: string): string {
  const key = merchantKey(name).replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  const words = key.split(" ").filter(Boolean);
  if (words.length === 0) return "";
  // Ein einzelnes kurzes Wort ist als Marke zu unspezifisch.
  if (words.length === 1) return words[0];
  return words.slice(0, 2).join(" ");
}
