import { budgetVergleich, prognose } from "@/server/budget";
import { verfuegbareMonate, erkenneWiederkehrend } from "@/server/queries";
import { budgetsAusHistorie } from "@/app/actions";
import { formatRappen } from "@/core/money";
import { Karte, KartenTitel, Etikett, monatName, Leer } from "@/components/ui";
import { MonatsWahl } from "@/components/MonatsWahl";
import { BudgetZeileFormular } from "./BudgetZeile";
import type { Necessity } from "@/core/types";

export const dynamic = "force-dynamic";

export default async function Budget({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const { monat: gewaehlt } = await searchParams;
  const monate = await verfuegbareMonate();
  if (monate.length === 0) {
    return (
      <Karte>
        <Leer titel="Noch keine Daten" text="Importiere zuerst deine Kontoauszüge." />
      </Karte>
    );
  }

  const monat = gewaehlt && monate.includes(gewaehlt) ? gewaehlt : monate[0];
  const zeilen = await budgetVergleich(monat);
  const vorschau = await prognose(6);
  const wiederkehrend = await erkenneWiederkehrend();

  const hatBudgets = zeilen.some((z) => z.budget !== null);
  const budgetSumme = zeilen.reduce((a, z) => a + (z.budget ?? 0), 0);
  const istSumme = zeilen.reduce((a, z) => a + z.ist, 0);
  const prognoseSumme = zeilen.reduce((a, z) => a + z.hochrechnung, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Budget</h1>
          <p className="text-sm text-[var(--text-secondary)]">{monatName(monat)}</p>
        </div>
        <MonatsWahl monate={monate} aktiv={monat} />
      </header>

      {!hatBudgets && (
        <Karte>
          <KartenTitel>Noch kein Budget gesetzt</KartenTitel>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            Das Tool kann aus deinen bisherigen Monaten Vorschläge berechnen — Median
            statt Durchschnitt, damit einzelne Ausreisser wie die Semestergebühr das
            Ergebnis nicht verzerren. Du kannst jeden Wert danach anpassen.
          </p>
          <form action={budgetsAusHistorie}>
            <button
              type="submit"
              className="rounded-lg bg-[var(--n-fix)] px-4 py-2 text-sm font-medium text-white"
            >
              Vorschläge übernehmen
            </button>
          </form>
        </Karte>
      )}

      {hatBudgets && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Kennzahl titel="Budget" wert={budgetSumme} />
          <Kennzahl titel="Bisher ausgegeben" wert={istSumme} />
          <Kennzahl
            titel="Hochrechnung Monatsende"
            wert={prognoseSumme}
            hinweis={
              prognoseSumme > budgetSumme
                ? `${formatRappen(prognoseSumme - budgetSumme)} über Budget`
                : `${formatRappen(budgetSumme - prognoseSumme)} Reserve`
            }
            warnung={prognoseSumme > budgetSumme}
          />
        </div>
      )}

      <Karte>
        <KartenTitel hinweis="Betrag anpassen und Enter drücken">
          Budget je Kategorie
        </KartenTitel>
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {zeilen.map((z) => (
            <BudgetZeileFormular key={z.slug} zeile={z} />
          ))}
        </ul>
      </Karte>

      {/* ── Prognose ──────────────────────────────────────────────────── */}
      <Karte>
        <KartenTitel hinweis="aus Fixkosten, typischem Aufwand und erkanntem Rhythmus">
          Die nächsten Monate
        </KartenTitel>
        <ul className="flex flex-col gap-3">
          {vorschau.map((p) => (
            <li key={p.monat} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-28 shrink-0 text-sm text-[var(--text-secondary)]">
                {monatName(p.monat)}
              </span>
              <span className="tabular font-semibold">{formatRappen(p.erwartet)}</span>
              {p.einmalig.length > 0 && (
                <span className="text-xs" style={{ color: "var(--n-freiwillig)" }}>
                  darin{" "}
                  {p.einmalig
                    .map((e) => `${e.label} ${formatRappen(e.betrag, { decimals: false })}`)
                    .join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          Die Prognose plant wiederkehrende Posten in ihrem echten Rhythmus ein. Eine
          halbjährliche Rechnung erscheint deshalb im richtigen Monat und nicht als
          Zwölftel in jedem.
        </p>
      </Karte>

      {/* ── Erkannte Fixkosten ────────────────────────────────────────── */}
      {wiederkehrend.length > 0 && (
        <Karte>
          <KartenTitel hinweis="aus dem Zahlungsmuster erkannt">
            Wiederkehrende Belastungen
          </KartenTitel>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {wiederkehrend.slice(0, 10).map((w) => (
              <li
                key={w.counterparty}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{w.counterparty}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {rhythmus(w.intervallTage)} · {w.anzahl}× erfasst · nächste
                    Belastung um den {new Date(w.naechstErwartet).toLocaleDateString("de-CH")}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm font-medium">
                  {formatRappen(Math.abs(w.typischerBetrag))}
                </span>
              </li>
            ))}
          </ul>
        </Karte>
      )}
    </div>
  );
}

function Kennzahl({
  titel, wert, hinweis, warnung,
}: { titel: string; wert: number; hinweis?: string; warnung?: boolean }) {
  return (
    <Karte>
      <p className="text-xs tracking-wide text-[var(--text-secondary)] uppercase">{titel}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{formatRappen(wert)}</p>
      {hinweis && (
        <p
          className="mt-1 text-xs font-medium"
          style={{ color: warnung ? "var(--n-freiwillig)" : "var(--good)" }}
        >
          {hinweis}
        </p>
      )}
    </Karte>
  );
}

function rhythmus(tage: number): string {
  if (tage <= 9) return "wöchentlich";
  if (tage <= 17) return "zweiwöchentlich";
  if (tage <= 45) return "monatlich";
  if (tage <= 100) return "vierteljährlich";
  if (tage <= 200) return "halbjährlich";
  return "jährlich";
}
