import { XMLParser } from "fast-xml-parser";
import { parseAmountToRappen } from "../money.js";
import { extractParty } from "./party.js";
import type { ParsedTransaction } from "../types.js";

/**
 * Parser für ISO-20022 CAMT.053 Kontoauszüge (Bank-to-Customer Statement).
 *
 * Getestet gegen camt.053.001.08 der Hypothekarbank Lenzburg. Namensräume
 * werden entfernt, damit auch .001.02 / .001.04 anderer Banken funktionieren —
 * die Elementnamen sind über die Versionen hinweg stabil.
 */

export interface CamtStatement {
  iban: string;
  currency: string;
  from?: string;
  to?: string;
  /** Eröffnungssaldo in Rappen. */
  openingBalance?: number;
  /** Schlusssaldo in Rappen. */
  closingBalance?: number;
  transactions: ParsedTransaction[];
  /** Nicht-fatale Auffälligkeiten, die im Import-Report angezeigt werden. */
  warnings: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false, // Beträge und IBANs bleiben Strings — keine Float-Fehler
  trimValues: true,
});

/** fast-xml-parser liefert Einzelelemente nicht als Array. */
function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

/** Signierte Rappen aus <Amt> + <CdtDbtInd>. DBIT = Geld raus = negativ. */
function signedAmount(node: any): { amount: number; currency: string } {
  const raw = text(node?.Amt) ?? "0";
  const currency = node?.Amt?.["@Ccy"] ?? "CHF";
  const magnitude = parseAmountToRappen(raw);
  const isDebit = text(node?.CdtDbtInd) === "DBIT";
  return { amount: isDebit ? -magnitude : magnitude, currency };
}

function bkTxCode(node: any): string | undefined {
  const d = node?.BkTxCd?.Domn;
  if (!d) return undefined;
  const parts = [text(d.Cd), text(d.Fmly?.Cd), text(d.Fmly?.SubFmlyCd)].filter(
    Boolean,
  );
  return parts.length ? parts.join("/") : undefined;
}

/** Zieht Name und IBAN der Gegenpartei aus <RltdPties>, sofern vorhanden. */
function structuredParty(
  tx: any,
  isDebit: boolean,
): { name?: string; iban?: string } {
  const rp = tx?.RltdPties;
  if (!rp) return {};
  // Bei einer Belastung ist die Gegenpartei der Kreditor, bei einer
  // Gutschrift der Debitor.
  const partyNode = isDebit ? rp.Cdtr : rp.Dbtr;
  const acctNode = isDebit ? tx?.RltdPties?.CdtrAcct : tx?.RltdPties?.DbtrAcct;
  const name = text(partyNode?.Pty?.Nm) ?? text(partyNode?.Nm);
  const iban = text(acctNode?.Id?.IBAN);
  return { name, iban };
}

function remittanceInfo(tx: any): string | undefined {
  const rmt = tx?.RmtInf;
  if (!rmt) return undefined;
  const unstructured = arr(rmt.Ustrd).map(text).filter(Boolean).join(" ");
  const structured = arr(rmt.Strd)
    .map((s: any) => text(s?.AddtlRmtInf))
    .filter(Boolean)
    .join(" ");
  const combined = [unstructured, structured].filter(Boolean).join(" ").trim();
  return combined || undefined;
}

export function parseCamt053(xml: string): CamtStatement[] {
  const doc = parser.parse(xml);
  const root = doc?.Document?.BkToCstmrStmt;
  if (!root) {
    throw new Error(
      "Kein CAMT.053-Dokument erkannt (erwartet <Document><BkToCstmrStmt>). " +
        "Stammt die Datei wirklich aus dem E-Banking-Export 'Kontoauszug ISO 20022'?",
    );
  }

  return arr(root.Stmt).map((stmt: any) => parseStatement(stmt));
}

function parseStatement(stmt: any): CamtStatement {
  const warnings: string[] = [];
  const iban = text(stmt?.Acct?.Id?.IBAN) ?? "unbekannt";
  const currency = text(stmt?.Acct?.Ccy) ?? "CHF";

  // Salden: OPBD = Eröffnung, CLBD = Schluss.
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  for (const bal of arr(stmt?.Bal)) {
    const code = text(bal?.Tp?.CdOrPrtry?.Cd);
    const { amount } = signedAmount(bal);
    // Salden tragen CRDT/DBIT als Vorzeichen des Saldos selbst.
    if (code === "OPBD") openingBalance = amount;
    if (code === "CLBD") closingBalance = amount;
  }

  const transactions: ParsedTransaction[] = [];

  for (const ntry of arr(stmt?.Ntry)) {
    const entryRef =
      text(ntry?.AcctSvcrRef) ??
      text(ntry?.NtryRef) ??
      `${text(ntry?.BookgDt?.Dt)}-${text(ntry?.Amt)}`;

    const bookingDate = text(ntry?.BookgDt?.Dt) ?? text(ntry?.BookgDt?.DtTm)?.slice(0, 10);
    const valueDate = text(ntry?.ValDt?.Dt) ?? text(ntry?.ValDt?.DtTm)?.slice(0, 10);
    const entryAmount = signedAmount(ntry);
    const entryInfo = text(ntry?.AddtlNtryInf) ?? "";
    const status = text(ntry?.Sts?.Cd) ?? text(ntry?.Sts);

    if (!bookingDate) {
      warnings.push(`Buchung ${entryRef} ohne Buchungsdatum — übersprungen.`);
      continue;
    }

    // Nur definitiv gebuchte Positionen. Vorgemerkte (PDNG) würden sich beim
    // nächsten Import mit anderer Referenz wiederholen und Duplikate erzeugen.
    if (status && status !== "BOOK") {
      warnings.push(
        `Buchung ${bookingDate} (${entryInfo.slice(0, 40)}) hat Status ${status} und wurde übersprungen.`,
      );
      continue;
    }

    const txDetails = arr(ntry?.NtryDtls).flatMap((d: any) => arr(d?.TxDtls));

    // Sammelbuchung aufteilen — sonst verschwindet z.B. eine Lohnzahlung in
    // einer Sammelgutschrift und taucht in keiner Auswertung auf.
    const shouldSplit = txDetails.length > 1;

    if (shouldSplit) {
      const parts = txDetails.map((tx) => signedAmount(tx).amount);
      const partSum = parts.reduce((a, b) => a + b, 0);

      if (partSum !== entryAmount.amount) {
        // Summenprobe fehlgeschlagen: lieber die Sammelbuchung als Ganzes
        // übernehmen als einen falschen Betrag auszuweisen.
        warnings.push(
          `Sammelbuchung ${bookingDate} (${entryInfo.slice(0, 40)}): Teilbeträge ` +
            `summieren sich nicht auf den Gesamtbetrag — als eine Buchung übernommen.`,
        );
        transactions.push(
          buildTransaction(ntry, null, entryRef, bookingDate, valueDate, iban, entryInfo, entryAmount, 0),
        );
        continue;
      }

      txDetails.forEach((tx, i) => {
        const txInfo = text(tx?.AddtlTxInf) ?? remittanceInfo(tx) ?? entryInfo;
        transactions.push(
          buildTransaction(
            ntry, tx, entryRef, bookingDate, valueDate, iban, txInfo,
            signedAmount(tx), i + 1,
          ),
        );
      });
      continue;
    }

    const tx = txDetails[0] ?? null;
    const info = text(tx?.AddtlTxInf) ?? entryInfo ?? remittanceInfo(tx) ?? "";
    transactions.push(
      buildTransaction(ntry, tx, entryRef, bookingDate, valueDate, iban, info, entryAmount, 0),
    );
  }

  return {
    iban,
    currency,
    from: text(stmt?.FrToDt?.FrDtTm)?.slice(0, 10),
    to: text(stmt?.FrToDt?.ToDtTm)?.slice(0, 10),
    openingBalance,
    closingBalance,
    transactions,
    warnings,
  };
}

function buildTransaction(
  ntry: any,
  tx: any,
  entryRef: string,
  bookingDate: string,
  valueDate: string | undefined,
  iban: string,
  info: string,
  amount: { amount: number; currency: string },
  partIndex: number,
): ParsedTransaction {
  const party = extractParty(info);
  const structured = structuredParty(tx, amount.amount < 0);
  const remittance = remittanceInfo(tx);

  // Strukturierte Daten schlagen die Textextraktion, wo vorhanden — sie sind
  // vom Absender gepflegt und damit verlässlicher als geratene Zeilen.
  const counterparty = structured.name ?? party.name;

  return {
    // Der Suffix trennt die Teile einer Sammelbuchung, ohne die Stabilität
    // der Referenz über mehrere Importe hinweg zu verlieren.
    externalId: partIndex > 0 ? `${entryRef}#${partIndex}` : entryRef,
    source: "camt053",
    accountRef: iban,
    bookingDate,
    valueDate,
    amount: amount.amount,
    currency: amount.currency,
    rawText: [info, remittance].filter(Boolean).join(" | ").trim(),
    counterparty: counterparty?.trim() || undefined,
    counterpartyIban: structured.iban,
    counterpartyPhone: party.phone,
    txTime: party.time,
    place: party.place,
    bankTxCode: bkTxCode(tx) ?? bkTxCode(ntry),
  };
}
