import { getSqlite, getSetting, getJsonSetting, SETTING_KEYS } from "@/db";
import { parseCamt053 } from "@/core/parsers/camt053";
import { parseSwisscardCsv } from "@/core/parsers/swisscard";
import { parseNeonCsv, istNeonCsv } from "@/core/parsers/neon";
import { categorize, needsReview } from "@/core/categorize/engine";
import { frageKi, mitKiErgaenzen, type KiAnbieter } from "@/core/categorize/ki";
import { ladeKontext } from "./context";
import type { ParsedTransaction } from "@/core/types";
import { formatRappen } from "@/core/money";

/**
 * Import einer Export-Datei.
 *
 * Zwei Eigenschaften sind hier entscheidend:
 *
 * 1. WIEDERHOLBAR. Dieselbe Datei zweimal einzulesen darf nichts verdoppeln.
 *    Das ist kein theoretischer Fall — die Exporte sind kumulativ seit
 *    Jahresbeginn, jeder Monatsimport enthält also alles Vorherige nochmals.
 *
 * 2. RESPEKTIERT HANDARBEIT. Eine Buchung, die bereits bestätigt wurde, wird
 *    beim erneuten Import nicht überschrieben. Sonst wäre jede Korrektur nach
 *    dem nächsten Import wieder weg.
 */

export interface ImportErgebnis {
  quelle: "camt053" | "swisscard" | "neon";
  dateiname: string;
  neu: number;
  bekannt: number;
  offen: number;
  zeitraum?: { von: string; bis: string };
  saldoprobe?: { ok: boolean; text: string };
  warnungen: string[];
  /** Erste Beispiele der neuen Buchungen, für die Rückmeldung im UI. */
  beispiele: Array<{ datum: string; betrag: string; gegenpartei: string; kategorie: string | null }>;
}

export function erkenneFormat(
  dateiname: string,
  inhalt: string,
): "camt053" | "swisscard" | "neon" | null {
  const name = dateiname.toLowerCase();
  if (inhalt.trimStart().startsWith("<?xml") || name.endsWith(".xml")) {
    return inhalt.includes("BkToCstmrStmt") ? "camt053" : null;
  }
  if (name.endsWith(".csv")) {
    // neon zuerst prüfen: der Auszug ist semikolongetrennt und trägt
    // Spaltennamen, die bei Swisscard nicht vorkommen.
    if (istNeonCsv(inhalt)) return "neon";
    const kopf = inhalt.slice(0, 500).toLowerCase();
    if (kopf.includes("transaktionsdatum") || kopf.includes("kartennummer")) return "swisscard";
    return "swisscard"; // andere Spaltennamen fängt der Parser selbst ab
  }
  return null;
}

export function importiere(dateiname: string, inhalt: string): ImportErgebnis {
  const format = erkenneFormat(dateiname, inhalt);
  if (!format) {
    throw new Error(
      `Format von "${dateiname}" nicht erkannt. Erwartet wird ein CAMT.053-XML ` +
        `aus dem E-Banking, ein CSV-Export von Swisscard oder ein neon-Auszug.`,
    );
  }

  if (format === "camt053") return importiereCamt(dateiname, inhalt);
  if (format === "neon") return importiereNeon(dateiname, inhalt);
  return importiereSwisscard(dateiname, inhalt);
}

function importiereNeon(dateiname: string, inhalt: string): ImportErgebnis {
  const imp = parseNeonCsv(inhalt);
  const res = schreibe(imp.transactions, "neon");
  const daten = imp.transactions.map((t) => t.bookingDate).sort();

  return {
    quelle: "neon",
    dateiname,
    ...res,
    zeitraum: daten.length ? { von: daten[0], bis: daten[daten.length - 1] } : undefined,
    warnungen: [...imp.warnings, ...res.warnungen],
  };
}

function importiereCamt(dateiname: string, inhalt: string): ImportErgebnis {
  const statements = parseCamt053(inhalt);
  const alle: ParsedTransaction[] = [];
  const warnungen: string[] = [];
  let saldoprobe: ImportErgebnis["saldoprobe"];
  let von: string | undefined;
  let bis: string | undefined;

  for (const s of statements) {
    alle.push(...s.transactions);
    warnungen.push(...s.warnings);
    von = von && s.from && von < s.from ? von : (s.from ?? von);
    bis = bis && s.to && bis > s.to ? bis : (s.to ?? bis);

    // Saldoprobe: deckt auf, wenn beim Einlesen etwas verloren ging.
    if (s.openingBalance !== undefined && s.closingBalance !== undefined) {
      const bewegung = s.transactions.reduce((a, t) => a + t.amount, 0);
      const erwartet = s.closingBalance - s.openingBalance;
      saldoprobe = {
        ok: bewegung === erwartet,
        text:
          bewegung === erwartet
            ? `Saldoprobe stimmt: ${formatRappen(s.openingBalance)} → ${formatRappen(s.closingBalance)}`
            : `Saldoprobe weicht ab: Buchungen ergeben ${formatRappen(bewegung)}, ` +
              `erwartet ${formatRappen(erwartet)}`,
      };
    }
  }

  const res = schreibe(alle, "camt053");
  return {
    quelle: "camt053",
    dateiname,
    ...res,
    zeitraum: von && bis ? { von, bis } : undefined,
    saldoprobe,
    warnungen: [...warnungen, ...res.warnungen],
  };
}

function importiereSwisscard(dateiname: string, inhalt: string): ImportErgebnis {
  const imp = parseSwisscardCsv(inhalt);

  // Die Ausgleichszahlungen werden mitgespeichert, aber als neutral markiert:
  // ihr Gegenstück steht bereits als SWISSCARD-Belastung im Bankauszug.
  const settlements = imp.settlements.map((t) => ({ ...t }));
  const res = schreibe([...imp.transactions, ...settlements], "swisscard", {
    neutralIds: new Set(settlements.map((t) => t.externalId)),
  });

  const daten = imp.transactions.map((t) => t.bookingDate).sort();
  return {
    quelle: "swisscard",
    dateiname,
    ...res,
    zeitraum: daten.length ? { von: daten[0], bis: daten[daten.length - 1] } : undefined,
    warnungen: [...imp.warnings, ...res.warnungen],
  };
}

function schreibe(
  transaktionen: ParsedTransaction[],
  quelle: string,
  opts: { neutralIds?: Set<string> } = {},
): Omit<ImportErgebnis, "quelle" | "dateiname" | "zeitraum" | "saldoprobe"> {
  const db = getSqlite();
  const ctx = ladeKontext();
  const jetzt = new Date().toISOString();

  const einfuegen = db.prepare(`
    INSERT INTO transactions (
      external_id, source, account_ref, card_ref, booking_date, value_date,
      amount, currency, fx_currency, fx_amount, raw_text, counterparty,
      counterparty_iban, counterparty_phone, tx_time, place, issuer_category,
      issuer_mcc, bank_tx_code, category_slug, treatment, confidence, stage,
      reason, reviewed, created_at, updated_at
    ) VALUES (
      @external_id, @source, @account_ref, @card_ref, @booking_date, @value_date,
      @amount, @currency, @fx_currency, @fx_amount, @raw_text, @counterparty,
      @counterparty_iban, @counterparty_phone, @tx_time, @place, @issuer_category,
      @issuer_mcc, @bank_tx_code, @category_slug, @treatment, @confidence, @stage,
      @reason, 0, @created_at, @updated_at
    )
    ON CONFLICT(source, external_id) DO NOTHING
  `);

  let neu = 0;
  let bekannt = 0;
  let offen = 0;
  const warnungen: string[] = [];
  const beispiele: ImportErgebnis["beispiele"] = [];

  // Alles in einer Transaktion: bricht der Import ab, bleibt kein halber
  // Monat in der Datenbank zurück.
  const lauf = db.transaction(() => {
    for (const t of transaktionen) {
      const vorschlag = categorize(t, ctx);
      const istNeutral = opts.neutralIds?.has(t.externalId);

      const info = einfuegen.run({
        external_id: t.externalId,
        source: quelle,
        account_ref: t.accountRef,
        card_ref: t.cardRef ?? null,
        booking_date: t.bookingDate,
        value_date: t.valueDate ?? null,
        amount: t.amount,
        currency: t.currency,
        fx_currency: t.fxCurrency ?? null,
        fx_amount: t.fxAmount ?? null,
        raw_text: t.rawText,
        counterparty: t.counterparty ?? null,
        counterparty_iban: t.counterpartyIban ?? null,
        counterparty_phone: t.counterpartyPhone ?? null,
        tx_time: t.txTime ?? null,
        place: t.place ?? null,
        issuer_category: t.issuerCategory ?? null,
        issuer_mcc: t.issuerMcc ?? null,
        bank_tx_code: t.bankTxCode ?? null,
        category_slug: istNeutral ? "kartenausgleich" : vorschlag.categorySlug,
        treatment: istNeutral ? "neutral" : (vorschlag.treatment ?? "normal"),
        confidence: istNeutral ? 1 : vorschlag.confidence,
        stage: istNeutral ? "struktur" : vorschlag.stage,
        reason: istNeutral
          ? "Ausgleich der Kartenrechnung — das Gegenstück steht im Bankauszug"
          : vorschlag.reason,
        created_at: jetzt,
        updated_at: jetzt,
      });

      if (info.changes === 0) {
        // Bereits vorhanden. Nicht anfassen — eine bestätigte Zuordnung
        // darf ein erneuter Import nicht zurücksetzen.
        bekannt++;
        continue;
      }

      neu++;
      if (!istNeutral && needsReview(vorschlag, ctx.reviewThreshold)) offen++;

      if (beispiele.length < 8) {
        beispiele.push({
          datum: t.bookingDate,
          betrag: formatRappen(t.amount, { sign: true }),
          gegenpartei: t.counterparty ?? "—",
          kategorie: istNeutral ? "kartenausgleich" : vorschlag.categorySlug,
        });
      }
    }
  });

  lauf();
  return { neu, bekannt, offen, warnungen, beispiele };
}

/**
 * Verknüpft Aufladungen des neon-Kontos mit ihrem Gegenstück.
 *
 * Auf dem Hauptkonto steht die Belastung, auf dem neon-Auszug die Gutschrift —
 * derselbe Vorgang, zweimal erfasst. Würde die Gutschrift als Einnahme
 * gezählt, sähe jeder Reisemonat nach einem Geldsegen aus.
 *
 * Die Zuordnung erfolgt über Betrag und ein enges Zeitfenster, weil neon den
 * Absender nicht immer als Namen mitliefert (manchmal steht dort der
 * Verwendungszweck, etwa "Airbnb Prag").
 */
export function verknuepfeKontoAufladungen(): number {
  const db = getSqlite();

  const eingaenge = db
    .prepare(
      `SELECT id, booking_date, amount FROM transactions
       WHERE source = 'neon' AND amount > 0 AND treatment = 'normal' AND reviewed = 0`,
    )
    .all() as Array<{ id: number; booking_date: string; amount: number }>;

  if (eingaenge.length === 0) return 0;

  const passendeBelastung = db.prepare(
    `SELECT id FROM transactions
     WHERE source = 'camt053' AND amount = ?
       AND ABS(julianday(booking_date) - julianday(?)) <= 7
     LIMIT 1`,
  );

  const markiere = db.prepare(
    `UPDATE transactions
     SET category_slug = 'eigenuebertrag', treatment = 'neutral', confidence = 1,
         stage = 'struktur', reason = ?, updated_at = ?
     WHERE id = ?`,
  );

  let n = 0;
  const jetzt = new Date().toISOString();
  db.transaction(() => {
    for (const e of eingaenge) {
      const treffer = passendeBelastung.get(-e.amount, e.booking_date) as
        | { id: number }
        | undefined;
      if (!treffer) continue;
      markiere.run(
        "Aufladung vom Hauptkonto — die Belastung dort ist bereits erfasst",
        jetzt,
        e.id,
      );
      n++;
    }
  })();

  return n;
}

/**
 * Prüft, ob zu den Aufladungen eines verknüpften Kontos auch die dortigen
 * Ausgaben vorliegen.
 *
 * Hintergrund: wird die Aufladung neutral gestellt, der zugehörige Auszug
 * aber nie importiert, verschwinden die Ausgaben spurlos aus der Auswertung.
 * Diese Prüfung macht genau diese Lücke sichtbar, statt sie zu verschweigen.
 */
export interface Deckungsluecke {
  jahr: string;
  aufgeladen: number;
  erfassteAusgaben: number;
  luecke: number;
}

export function pruefeDeckung(): Deckungsluecke[] {
  const verknuepft = getJsonSetting<string[]>(SETTING_KEYS.linkedIbans, []).map((i) =>
    i.replace(/\s/g, "").toUpperCase(),
  );
  if (verknuepft.length === 0) return [];

  const db = getSqlite();
  const platzhalter = verknuepft.map(() => "?").join(",");

  // Was floss vom Hauptkonto aufs verknüpfte Konto?
  const aufgeladen = db
    .prepare(
      `SELECT substr(booking_date,1,4) AS jahr, SUM(ABS(amount)) AS summe
       FROM transactions
       WHERE source = 'camt053' AND amount < 0
         AND counterparty_iban IN (${platzhalter})
       GROUP BY jahr`,
    )
    .all(...verknuepft) as Array<{ jahr: string; summe: number }>;

  // Was wurde von dort tatsächlich ausgegeben?
  const ausgegeben = new Map(
    (
      db
        .prepare(
          `SELECT substr(booking_date,1,4) AS jahr, SUM(ABS(amount)) AS summe
           FROM transactions WHERE source = 'neon' AND amount < 0
           GROUP BY jahr`,
        )
        .all() as Array<{ jahr: string; summe: number }>
    ).map((r) => [r.jahr, r.summe]),
  );

  return aufgeladen
    .map((a) => ({
      jahr: a.jahr,
      aufgeladen: a.summe,
      erfassteAusgaben: ausgegeben.get(a.jahr) ?? 0,
      luecke: a.summe - (ausgegeben.get(a.jahr) ?? 0),
    }))
    // Kleine Abweichungen sind normal — das Konto trägt einen Restsaldo über
    // den Jahreswechsel. Gemeldet wird nur, was ins Gewicht fällt.
    .filter((d) => d.luecke > 20000)
    .sort((a, b) => b.luecke - a.luecke);
}

/**
 * Zweiter Durchgang: unbekannte Händler von der KI einschätzen lassen.
 *
 * Läuft NACH dem Schreiben, damit ein Ausfall des Dienstes den Import nicht
 * aufhält. Ohne hinterlegten Schlüssel passiert schlicht nichts.
 */
export async function ergaenzeMitKi(): Promise<number> {
  const anbieter = getSetting(SETTING_KEYS.aiProvider) as KiAnbieter | null;
  const apiKey = getSetting(SETTING_KEYS.aiApiKey);
  if (!anbieter || !apiKey) return 0;

  const db = getSqlite();
  const offen = db
    .prepare(
      `SELECT DISTINCT counterparty FROM transactions
       WHERE reviewed = 0 AND counterparty IS NOT NULL
         AND (category_slug IS NULL OR confidence < 0.75)
         AND counterparty_phone IS NULL
       LIMIT 40`,
    )
    .all() as Array<{ counterparty: string }>;

  if (offen.length === 0) return 0;

  const ergebnis = await frageKi(
    offen.map((o) => o.counterparty),
    { anbieter, apiKey },
  );
  if (ergebnis.size === 0) return 0;

  const aktualisiere = db.prepare(
    `UPDATE transactions
     SET category_slug = ?, confidence = ?, stage = 'ki', reason = ?, updated_at = ?
     WHERE counterparty = ? AND reviewed = 0 AND (category_slug IS NULL OR confidence < ?)`,
  );

  let n = 0;
  const jetzt = new Date().toISOString();
  db.transaction(() => {
    for (const { counterparty } of offen) {
      const vorschlag = mitKiErgaenzen(
        { categorySlug: null, confidence: 0, stage: "unbekannt", reason: "" },
        { counterparty } as ParsedTransaction,
        ergebnis,
      );
      if (vorschlag.stage !== "ki" || !vorschlag.categorySlug) continue;
      aktualisiere.run(
        vorschlag.categorySlug, vorschlag.confidence, vorschlag.reason,
        jetzt, counterparty, vorschlag.confidence,
      );
      n++;
    }
  })();

  return n;
}

/** Protokolliert einen Import, damit später nachvollziehbar ist, was hereinkam. */
export function protokolliere(e: ImportErgebnis): void {
  getSqlite()
    .prepare(
      `INSERT INTO imports (filename, source, imported_at, period_from, period_to,
         new_count, duplicate_count, warnings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.dateiname,
      e.quelle,
      new Date().toISOString(),
      e.zeitraum?.von ?? null,
      e.zeitraum?.bis ?? null,
      e.neu,
      e.bekannt,
      e.warnungen.length ? JSON.stringify(e.warnungen) : null,
    );
}
