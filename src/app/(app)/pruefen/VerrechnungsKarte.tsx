"use client";

import { verrechne, bestaetige } from "@/app/actions";
import { formatRappen } from "@/core/money";
import { kurzDatum } from "@/components/ui";
import { CATEGORY_BY_SLUG } from "@/core/categorize/categories";
import type { OffeneBuchung } from "@/server/queries";
import type { OffsetKandidat } from "@/core/offset/matcher";

/**
 * Vorschlag, einen Geldeingang mit einer Ausgabe zu verrechnen.
 *
 * Bewusst kein Automatismus: 40 Franken von einem Kollegen können die
 * Rückzahlung für das gemeinsame Essen sein — oder eine alte Schuld, die
 * nichts mit dieser Ausgabe zu tun hat. Nur du weisst das.
 *
 * Die Auswirkung steht direkt dabei, damit die Entscheidung nicht abstrakt
 * bleibt: "Restaurant zählt dann als 20 statt 60."
 */
export function VerrechnungsKarte({
  eingang, kandidaten, ausgaben,
}: {
  eingang: OffeneBuchung;
  kandidaten: OffsetKandidat[];
  ausgaben: Array<{ id: number; bookingDate: string; amount: number; counterparty: string | null; categorySlug: string | null }>;
}) {
  const beste = kandidaten[0];
  const ausgabeVon = (id: number) => ausgaben.find((a) => a.id === id);

  return (
    <div className="karte p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{eingang.counterparty ?? "Geldeingang"}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {kurzDatum(eingang.bookingDate)} · Eingang
          </p>
        </div>
        <span className="tabular shrink-0 font-semibold" style={{ color: "var(--good)" }}>
          {formatRappen(eingang.amount, { sign: true })}
        </span>
      </div>

      <p className="mt-3 mb-2 text-xs text-[var(--text-secondary)]">
        Gehört das zu einer dieser Ausgaben?
      </p>

      <div className="flex flex-col gap-2">
        {kandidaten.slice(0, 3).map((k) => {
          const a = ausgabeVon(k.ausgabeId);
          if (!a) return null;
          const netto = Math.max(0, Math.abs(a.amount) - eingang.amount);
          const def = a.categorySlug ? CATEGORY_BY_SLUG.get(a.categorySlug) : undefined;

          return (
            <form key={k.ausgabeId} action={verrechne}>
              <input type="hidden" name="eingangId" value={eingang.id} />
              <input type="hidden" name="ausgabeId" value={k.ausgabeId} />
              <button
                type="submit"
                className="w-full rounded-lg border border-[var(--border)] p-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                style={k === beste ? { borderColor: "var(--n-fix)" } : undefined}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {def?.icon} {a.counterparty ?? "Ausgabe"}
                  </span>
                  <span className="tabular shrink-0 text-sm">
                    {formatRappen(a.amount)}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  {kurzDatum(a.bookingDate)} · {k.grund}
                </span>
                <span className="mt-1.5 block text-xs" style={{ color: "var(--n-fix)" }}>
                  Zählt danach als {formatRappen(-netto)} statt {formatRappen(a.amount)}
                </span>
              </button>
            </form>
          );
        })}
      </div>

      <form action={bestaetige} className="mt-2">
        <input type="hidden" name="id" value={eingang.id} />
        <button
          type="submit"
          className="text-xs text-[var(--text-muted)] underline underline-offset-2"
        >
          Nein, das gehört zu keiner Ausgabe
        </button>
      </form>
    </div>
  );
}
