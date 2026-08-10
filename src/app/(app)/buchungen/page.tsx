import { getDb } from "@/db";
import { verfuegbareMonate } from "@/server/queries";
import { formatRappen } from "@/core/money";
import { CATEGORY_BY_SLUG } from "@/core/categorize/categories";
import { Karte, KartenTitel, Etikett, Leer, monatName, kurzDatum } from "@/components/ui";
import { MonatsWahl } from "@/components/MonatsWahl";
import { ErfassungsFormular } from "./ErfassungsFormular";
import { loescheBuchung } from "@/app/actions";
import type { Necessity } from "@/core/types";

export const dynamic = "force-dynamic";

interface Zeile {
  id: number;
  bookingDate: string;
  amount: number;
  nettoAmount: number;
  counterparty: string | null;
  categorySlug: string | null;
  necessityOverride: string | null;
  source: string;
  place: string | null;
  reviewed: number;
  treatment: string;
  offsetSumme: number | null;
}

export default async function Buchungen({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string; kategorie?: string }>;
}) {
  const { monat: gewaehlt, kategorie } = await searchParams;
  const monate = await verfuegbareMonate();
  const monat = gewaehlt && monate.includes(gewaehlt) ? gewaehlt : monate[0];

  const db = await getDb();
  const zeilen = monat
    ? await db.all<Zeile>(
        `SELECT t.id, t.booking_date AS bookingDate, t.amount,
                MIN(0, t.amount + COALESCE((SELECT SUM(o.amount) FROM transactions o
                  WHERE o.offset_of = t.id), 0)) AS nettoAmount,
                t.counterparty, t.category_slug AS categorySlug,
                t.necessity_override AS necessityOverride, t.source, t.place,
                t.reviewed, t.treatment,
                (SELECT SUM(o.amount) FROM transactions o WHERE o.offset_of = t.id) AS offsetSumme
         FROM transactions t
         WHERE t.offset_of IS NULL AND substr(t.booking_date,1,7) = ?
           ${kategorie ? "AND t.category_slug = ?" : ""}
         ORDER BY t.booking_date DESC, t.id DESC`,
        kategorie ? [monat, kategorie] : [monat],
      )
    : [];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Buchungen</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {monat ? `${monatName(monat)} · ${zeilen.length} Einträge` : "Noch keine Daten"}
          </p>
        </div>
        {monate.length > 0 && <MonatsWahl monate={monate} aktiv={monat} />}
      </header>

      <Karte>
        <KartenTitel hinweis="Bargeld oder anderes Konto">Ausgabe nachtragen</KartenTitel>
        <ErfassungsFormular />
      </Karte>

      {zeilen.length === 0 ? (
        <Karte>
          <Leer
            titel="Keine Buchungen"
            text="Für diesen Monat liegen keine Einträge vor."
          />
        </Karte>
      ) : (
        <Karte padding={false}>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {zeilen.map((z) => {
              const def = z.categorySlug ? CATEGORY_BY_SLUG.get(z.categorySlug) : undefined;
              const notwendigkeit = (z.necessityOverride ??
                def?.necessity ??
                "freiwillig") as Necessity;
              const verrechnet = (z.offsetSumme ?? 0) > 0;
              const anzeige = z.amount < 0 ? z.nettoAmount : z.amount;

              return (
                <li key={z.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {z.counterparty ?? "Ohne Gegenpartei"}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>{kurzDatum(z.bookingDate)}</span>
                      {def && (
                        <span>
                          {def.icon} {def.label}
                        </span>
                      )}
                      {z.source === "swisscard" && <span>Karte</span>}
                      {z.source === "manual" && <span>selbst erfasst</span>}
                      {!z.reviewed && z.treatment === "normal" && !def && (
                        <span style={{ color: "var(--n-freiwillig)" }}>nicht zugeordnet</span>
                      )}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className="tabular text-sm font-medium"
                      style={{
                        color:
                          z.treatment === "neutral"
                            ? "var(--text-muted)"
                            : z.amount > 0
                              ? "var(--good)"
                              : undefined,
                      }}
                    >
                      {formatRappen(anzeige, { sign: z.amount > 0 })}
                    </p>
                    {verrechnet && (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        von {formatRappen(z.amount)} verrechnet
                      </p>
                    )}
                  </div>

                  {z.source === "manual" && (
                    <form action={loescheBuchung}>
                      <input type="hidden" name="id" value={z.id} />
                      <button
                        type="submit"
                        aria-label="Buchung löschen"
                        className="px-1 text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        ✕
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Karte>
      )}
    </div>
  );
}
