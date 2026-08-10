import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Tests für die Datenbankschicht.
 *
 * Geschrieben VOR der Umstellung von better-sqlite3 auf libSQL. Sie halten
 * fest, was sich durch den Treiberwechsel nicht ändern darf: die Nettorechnung
 * mit Verrechnungen, das Ausklammern neutraler Buchungen, die Wiederholbarkeit
 * des Imports und die Erkennung wiederkehrender Belastungen.
 *
 * Jeder Testlauf bekommt eine eigene Datenbankdatei — sonst würden sich die
 * Fälle gegenseitig beeinflussen.
 */

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "ft-test-"));
let lauf = 0;

async function frischeDb() {
  lauf++;
  process.env.DATABASE_PATH = path.join(TEMP, `test-${lauf}.db`);
  delete process.env.TURSO_DATABASE_URL;
  const db = await import("@/db");
  db._reset();
  return db.getDb();
}

afterAll(() => {
  fs.rmSync(TEMP, { recursive: true, force: true });
});

/** Legt eine Buchung an. Nur die Felder, die der jeweilige Test braucht. */
async function buchung(over: {
  id?: number;
  datum: string;
  betrag: number;
  kategorie?: string | null;
  treatment?: string;
  gegenpartei?: string;
  offsetOf?: number;
  reviewed?: number;
  confidence?: number;
  quelle?: string;
  externalId?: string;
  gegenIban?: string;
}) {
  const { getDb } = await import("@/db");
  const db = await getDb();
  const jetzt = new Date().toISOString();
  await db.run(
    `INSERT INTO transactions (
       external_id, source, account_ref, booking_date, amount, currency,
       raw_text, counterparty, counterparty_iban, category_slug, treatment,
       confidence, reviewed, offset_of, created_at, updated_at
     ) VALUES (?, ?, 'CH00', ?, ?, 'CHF', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      over.externalId ?? `t${Math.random().toString(36).slice(2)}`,
      over.quelle ?? "camt053",
      over.datum,
      over.betrag,
      over.gegenpartei ?? null,
      over.gegenIban ?? null,
      over.kategorie ?? null,
      over.treatment ?? "normal",
      over.confidence ?? 1,
      over.reviewed ?? 1,
      over.offsetOf ?? null,
      jetzt,
      jetzt,
    ],
  );
  const r = await db.get<{ id: number }>("SELECT last_insert_rowid() AS id");
  return r!.id;
}

describe("Nettorechnung", () => {
  beforeEach(frischeDb);

  it("zieht eine Rückzahlung von der Ausgabe ab", async () => {
    const { monatsUebersicht } = await import("@/server/queries");
    // 60 Franken Restaurant, ein Kollege zahlt 40 zurück.
    const ausgabe = await buchung({ datum: "2026-05-10", betrag: -6000, kategorie: "auswaerts" });
    await buchung({
      datum: "2026-05-12", betrag: 4000, kategorie: "erstattung",
      treatment: "neutral", offsetOf: ausgabe,
    });

    const u = await monatsUebersicht("2026-05");
    expect(u.ausgaben).toBe(-2000);
  });

  it("kappt bei null, wenn mehr zurückkommt als ausgegeben wurde", async () => {
    const { monatsUebersicht } = await import("@/server/queries");
    const ausgabe = await buchung({ datum: "2026-05-10", betrag: -5000, kategorie: "shopping" });
    await buchung({
      datum: "2026-05-20", betrag: 6000, kategorie: "erstattung",
      treatment: "neutral", offsetOf: ausgabe,
    });

    const u = await monatsUebersicht("2026-05");
    // Eine überzahlte Rückerstattung darf keine negative Ausgabe erzeugen.
    expect(u.ausgaben).toBe(0);
  });

  it("lässt neutrale Buchungen aus Ausgaben und Einnahmen heraus", async () => {
    const { monatsUebersicht } = await import("@/server/queries");
    await buchung({ datum: "2026-05-01", betrag: -1000, kategorie: "lebensmittel" });
    await buchung({
      datum: "2026-05-02", betrag: -1700000,
      kategorie: "investment", treatment: "neutral",
    });

    const u = await monatsUebersicht("2026-05");
    // Ohne diese Trennung würde eine Umschichtung jede Statistik zerstören.
    expect(u.ausgaben).toBe(-1000);
    expect(u.neutralSumme).toBe(-1700000);
  });
});

describe("Monatsverlauf", () => {
  beforeEach(frischeDb);

  it("teilt die Ausgaben nach Notwendigkeit auf", async () => {
    const { monatsReihe } = await import("@/server/queries");
    await buchung({ datum: "2026-05-01", betrag: -48800, kategorie: "miete" });
    await buchung({ datum: "2026-05-02", betrag: -5000, kategorie: "lebensmittel" });
    await buchung({ datum: "2026-05-03", betrag: -3000, kategorie: "auswaerts" });
    await buchung({ datum: "2026-05-04", betrag: 200000, kategorie: "lohn" });

    const [mai] = await monatsReihe();
    expect(mai.monat).toBe("2026-05");
    expect(mai.fix).toBe(48800);
    expect(mai.noetig).toBe(5000);
    expect(mai.freiwillig).toBe(3000);
    expect(mai.einnahmen).toBe(200000);
    expect(mai.ausgaben).toBe(56800);
  });
});

describe("Wiederkehrende Belastungen", () => {
  beforeEach(frischeDb);

  it("erkennt eine monatliche Miete am gleichen Stichtag", async () => {
    const { erkenneWiederkehrend } = await import("@/server/queries");
    for (const m of ["01", "02", "03", "04", "05"]) {
      await buchung({
        datum: `2026-${m}-28`, betrag: -48800,
        kategorie: "miete", gegenpartei: "Vermieter AG",
      });
    }
    const treffer = await erkenneWiederkehrend();
    expect(treffer.map((t) => t.counterparty)).toContain("Vermieter AG");
  });

  it("erkennt eine halbjährliche Rechnung trotz wechselnder Tage", async () => {
    const { erkenneWiederkehrend } = await import("@/server/queries");
    // Eine Rechnung mit Zahlungsfrist trifft nicht denselben Kalendertag.
    for (const d of ["2024-08-27", "2025-01-17", "2025-08-18", "2026-01-26"]) {
      await buchung({
        datum: d, betrag: -122900, kategorie: "ausbildung", gegenpartei: "Hochschule",
      });
    }
    const treffer = await erkenneWiederkehrend();
    expect(treffer.map((t) => t.counterparty)).toContain("Hochschule");
  });

  it("hält eine Gewohnheit mit festem Preis heraus", async () => {
    const { erkenneWiederkehrend } = await import("@/server/queries");
    // Immer derselbe Menüpreis, alle drei Monate — sieht rechnerisch wie ein
    // Abo aus, ist aber keines.
    for (const d of ["2025-01-04", "2025-04-11", "2025-07-19", "2025-10-02", "2026-01-15"]) {
      await buchung({ datum: d, betrag: -1690, kategorie: "auswaerts", gegenpartei: "Beiz" });
    }
    const treffer = await erkenneWiederkehrend();
    expect(treffer.map((t) => t.counterparty)).not.toContain("Beiz");
  });

  it("hält Beträge unter 14 Franken heraus", async () => {
    const { erkenneWiederkehrend } = await import("@/server/queries");
    for (const m of ["01", "02", "03", "04", "05"]) {
      await buchung({
        datum: `2026-${m}-22`, betrag: -300, kategorie: "abos", gegenpartei: "Kleinabo",
      });
    }
    const treffer = await erkenneWiederkehrend();
    expect(treffer.map((t) => t.counterparty)).not.toContain("Kleinabo");
  });
});

describe("Budgetvorschläge", () => {
  beforeEach(frischeDb);

  it("nutzt den Median, damit ein Ausreisser nicht durchschlägt", async () => {
    const { budgetVorschlaege } = await import("@/server/budget");
    // Vier normale Monate und ein Ausreisser.
    for (const [m, betrag] of [
      ["01", -10000], ["02", -12000], ["03", -11000], ["04", -13000], ["05", -500000],
    ] as const) {
      await buchung({ datum: `2026-${m}-10`, betrag, kategorie: "auswaerts" });
    }
    const v = await budgetVorschlaege();
    const auswaerts = v.get("auswaerts")!.betrag;
    // Der Durchschnitt läge bei 109'200 — der Median ist brauchbar.
    expect(auswaerts).toBeLessThan(20000);
    expect(auswaerts).toBeGreaterThan(9000);
  });
});

describe("Offene Zuordnungen", () => {
  beforeEach(frischeDb);

  it("zeigt die betragsmässig grössten zuerst", async () => {
    const { offeneBuchungen } = await import("@/server/queries");
    await buchung({ datum: "2026-05-01", betrag: -300, reviewed: 0, confidence: 0 });
    await buchung({ datum: "2026-05-02", betrag: -50000, reviewed: 0, confidence: 0 });
    await buchung({ datum: "2026-05-03", betrag: -2000, reviewed: 0, confidence: 0 });

    const offen = await offeneBuchungen();
    expect(offen.map((o) => o.amount)).toEqual([-50000, -2000, -300]);
  });

  it("übergeht, was bereits bestätigt wurde", async () => {
    const { offeneBuchungen } = await import("@/server/queries");
    await buchung({ datum: "2026-05-01", betrag: -300, reviewed: 1, confidence: 1, kategorie: "auswaerts" });
    expect(await offeneBuchungen()).toHaveLength(0);
  });
});

describe("Einstellungen", () => {
  beforeEach(frischeDb);

  it("speichert und liest Werte und Listen", async () => {
    const { getSetting, setSetting, getJsonSetting, setJsonSetting } = await import("@/db");
    await setSetting("a", "1");
    expect(await getSetting("a")).toBe("1");

    // Zweites Schreiben überschreibt, statt zu scheitern.
    await setSetting("a", "2");
    expect(await getSetting("a")).toBe("2");

    await setJsonSetting("liste", ["CH01", "CH02"]);
    expect(await getJsonSetting<string[]>("liste", [])).toEqual(["CH01", "CH02"]);
    expect(await getJsonSetting<string[]>("fehlt", ["standard"])).toEqual(["standard"]);
  });
});

describe("Import", () => {
  beforeEach(frischeDb);

  it("überspringt beim zweiten Durchgang alles Bekannte", async () => {
    const { importiere } = await import("@/server/import");
    const xml = beispielAuszug();

    const erst = await importiere("auszug.xml", xml);
    expect(erst.neu).toBeGreaterThan(0);
    expect(erst.bekannt).toBe(0);

    // Die Exporte sind kumulativ — ein zweiter Import darf nichts verdoppeln.
    const zweit = await importiere("auszug.xml", xml);
    expect(zweit.neu).toBe(0);
    expect(zweit.bekannt).toBe(erst.neu);
  });

  it("meldet die Saldoprobe", async () => {
    const { importiere } = await import("@/server/import");
    const e = await importiere("auszug.xml", beispielAuszug());
    expect(e.saldoprobe?.ok).toBe(true);
  });

  it("überschreibt eine bestätigte Zuordnung nicht", async () => {
    const { importiere } = await import("@/server/import");
    const { getDb } = await import("@/db");
    const xml = beispielAuszug();
    await importiere("auszug.xml", xml);

    const db = await getDb();
    await db.run(
      "UPDATE transactions SET category_slug = 'geschenke', reviewed = 1, confidence = 1",
    );

    await importiere("auszug.xml", xml);
    const rows = await db.all<{ category_slug: string }>(
      "SELECT category_slug FROM transactions",
    );
    // Sonst wäre jede Korrektur nach dem nächsten Monatsimport wieder weg.
    expect(rows.every((r) => r.category_slug === "geschenke")).toBe(true);
  });
});

/** Minimaler, aber gültiger CAMT.053-Auszug mit erfundenen Angaben. */
function beispielAuszug(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>
<GrpHdr><MsgId>m1</MsgId><CreDtTm>2026-06-01T00:00:00</CreDtTm></GrpHdr>
<Stmt><Id>s1</Id>
<FrToDt><FrDtTm>2026-05-01T00:00:00</FrDtTm><ToDtTm>2026-05-31T00:00:00</ToDtTm></FrToDt>
<Acct><Id><IBAN>CH0000000000000000000</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-05-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">940.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-05-31</Dt></Dt></Bal>
<Ntry><Amt Ccy="CHF">45.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
  <BookgDt><Dt>2026-05-04</Dt></BookgDt><AcctSvcrRef>ref-a</AcctSvcrRef>
  <AddtlNtryInf>12:00 Uhr, Coop-1234 Musterstadt
8000 Musterstadt</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="CHF">14.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
  <BookgDt><Dt>2026-05-09</Dt></BookgDt><AcctSvcrRef>ref-b</AcctSvcrRef>
  <AddtlNtryInf>08:15 Uhr, SBB Musterstadt
8000 Musterstadt</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
}
