"use client";

import { speichereBudget } from "@/app/actions";
import { formatRappen } from "@/core/money";
import { Etikett } from "@/components/ui";
import type { BudgetZeile } from "@/server/budget";

/**
 * Eine Budgetzeile.
 *
 * Der Fortschrittsbalken färbt sich erst orange, wenn die HOCHRECHNUNG das
 * Budget übersteigt — nicht schon beim Ist-Wert. Am 10. des Monats die Hälfte
 * ausgegeben zu haben ist kein Problem, sondern normal; das Signal soll
 * kommen, wenn das Tempo nicht aufgeht.
 */
export function BudgetZeileFormular({ zeile }: { zeile: BudgetZeile }) {
  const budget = zeile.budget ?? zeile.vorschlag;
  const anteil = budget > 0 ? zeile.ist / budget : 0;
  const anteilPrognose = budget > 0 ? zeile.hochrechnung / budget : 0;
  const drohtUeber = anteilPrognose > 1.02;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <span aria-hidden>{zeile.icon}</span>
          <span className="font-medium">{zeile.label}</span>
          <Etikett necessity={zeile.necessity} />
        </span>

        <form action={speichereBudget} className="flex items-center gap-2">
          <input type="hidden" name="slug" value={zeile.slug} />
          <span className="tabular text-sm text-[var(--text-secondary)]">
            {formatRappen(zeile.ist)} /
          </span>
          <input
            type="text"
            inputMode="decimal"
            name="betrag"
            defaultValue={zeile.budget !== null ? (zeile.budget / 100).toFixed(0) : ""}
            placeholder={zeile.vorschlag > 0 ? (zeile.vorschlag / 100).toFixed(0) : "—"}
            aria-label={`Budget für ${zeile.label} in Franken`}
            className="tabular w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-2 py-1 text-right text-sm"
          />
          <button type="submit" className="sr-only">
            Budget speichern
          </button>
        </form>
      </div>

      {budget > 0 && (
        <div className="mt-2">
          <div className="relative flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="rounded-full"
              style={{
                width: `${Math.min(100, anteil * 100)}%`,
                background: drohtUeber ? "var(--n-freiwillig)" : `var(--n-${zeile.necessity})`,
              }}
            />
            {/* Markierung der Hochrechnung, sofern sie über dem Ist liegt */}
            {anteilPrognose > anteil && anteilPrognose <= 1.6 && (
              <span
                aria-hidden
                className="absolute top-0 h-full w-0.5 bg-[var(--text-muted)]"
                style={{ left: `${Math.min(99.5, anteilPrognose * 100)}%` }}
              />
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Hochrechnung {formatRappen(zeile.hochrechnung)}
            {zeile.budget !== null && drohtUeber && (
              <span style={{ color: "var(--n-freiwillig)" }}>
                {" "}· {formatRappen(zeile.hochrechnung - zeile.budget)} über Budget
              </span>
            )}
            {zeile.budget === null && zeile.vorschlag > 0 && (
              <span> · Vorschlag aus {zeile.anzahlMonate} Monaten</span>
            )}
          </p>
        </div>
      )}
    </li>
  );
}
