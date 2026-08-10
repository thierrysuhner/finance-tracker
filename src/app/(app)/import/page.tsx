import { getDb } from "@/db";
import { Karte, KartenTitel } from "@/components/ui";
import { ImportFormular } from "./ImportFormular";

export const dynamic = "force-dynamic";

export default async function Import() {
  const db = await getDb();
  const letzte = await db.all<{
    filename: string; source: string; imported_at: string;
    period_from: string | null; period_to: string | null;
    new_count: number; duplicate_count: number;
  }>(
    `SELECT filename, source, imported_at, period_from, period_to,
            new_count, duplicate_count
     FROM imports ORDER BY id DESC LIMIT 10`,
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Import</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Kontoauszug und Kartenexport einlesen
        </p>
      </header>

      <Karte>
        <ImportFormular />
      </Karte>

      <Karte>
        <KartenTitel>So kommst du an die Dateien</KartenTitel>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-[var(--text-secondary)]">
          <li>
            <span className="font-medium text-[var(--text-primary)]">Bankkonto:</span> im
            E-Banking der Hypothekarbank Lenzburg den Kontoauszug im Format{" "}
            <span className="font-medium">ISO 20022 (CAMT.053)</span> als XML herunterladen.
            Der Export ist kumulativ seit Jahresbeginn — das ist kein Problem, bereits
            bekannte Buchungen werden erkannt und übersprungen.
          </li>
          <li>
            <span className="font-medium text-[var(--text-primary)]">Kreditkarte:</span> im
            Swisscard-Portal unter Transaktionen den CSV-Export ziehen. Ohne diese Datei
            erscheint die Monatsrechnung nur als ein Betrag, und rund ein Viertel deiner
            Ausgaben bliebe ohne Kategorie.
          </li>
          <li>
            Beide Dateien hier hochladen. Die Ausgleichszahlung der Kartenrechnung wird
            automatisch erkannt und nicht doppelt gezählt.
          </li>
        </ol>
      </Karte>

      {letzte.length > 0 && (
        <Karte>
          <KartenTitel>Bisherige Importe</KartenTitel>
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {letzte.map((i, n) => (
              <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate">{i.filename}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {new Date(i.imported_at).toLocaleString("de-CH", {
                      dateStyle: "short", timeStyle: "short",
                    })}
                    {i.period_from && ` · ${i.period_from} bis ${i.period_to}`}
                  </p>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">
                  {i.new_count} neu
                  {i.duplicate_count > 0 && `, ${i.duplicate_count} bekannt`}
                </span>
              </li>
            ))}
          </ul>
        </Karte>
      )}
    </div>
  );
}
