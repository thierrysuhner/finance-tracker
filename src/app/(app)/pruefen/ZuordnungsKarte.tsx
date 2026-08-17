"use client";

import { useState } from "react";
import { ordneZu } from "@/app/actions";
import { formatRappen } from "@/core/money";
import { CATEGORIES, CATEGORY_BY_SLUG } from "@/core/categorize/categories";
import { Etikett, kurzDatum } from "@/components/ui";
import type { OffeneBuchung } from "@/server/queries";
import type { Necessity } from "@/core/types";

/**
 * Eine Rückfrage.
 *
 * Aufbau nach Aufwand: die wahrscheinlichsten Kategorien als grosse Knöpfe
 * (ein Tipp genügt), alles Übrige hinter einer Auswahlliste. Wer zwölf
 * Buchungen im Monat zuordnet, soll das in einer Minute schaffen.
 */
export function ZuordnungsKarte({ buchung }: { buchung: OffeneBuchung }) {
  const [offen, setOffen] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<string>(buchung.categorySlug ?? "");

  const istEinnahme = buchung.amount > 0;
  const vorschlaege = schnellauswahl(buchung, istEinnahme);

  return (
    // Ohne Vorgabe: die Kategorie kommt dann aus der Auswahlliste unten.
    <form action={ordneZu.bind(null, null)} className="karte p-4">
      <input type="hidden" name="id" value={buchung.id} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{buchung.counterparty ?? "Ohne Gegenpartei"}</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {kurzDatum(buchung.bookingDate)}
            {buchung.place && ` · ${buchung.place}`}
            {buchung.source === "swisscard" && " · Kreditkarte"}
          </p>
          {buchung.reason && (
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">{buchung.reason}</p>
          )}
        </div>
        <span
          className="tabular shrink-0 font-semibold"
          style={{ color: istEinnahme ? "var(--good)" : undefined }}
        >
          {formatRappen(buchung.amount, { sign: istEinnahme })}
        </span>
      </div>

      {/*
        Schnellauswahl. Jeder Knopf bindet seine Kategorie an die Action —
        über Name und Wert des Knopfes ginge sie verloren, React übernimmt
        beides bei einer Server Action nicht ins FormData.
      */}
      <div className="mt-3 flex flex-wrap gap-2">
        {vorschlaege.map((slug) => {
          const c = CATEGORY_BY_SLUG.get(slug)!;
          const aktiv = gewaehlt === slug;
          return (
            <button
              key={slug}
              type="submit"
              formAction={ordneZu.bind(null, slug)}
              onClick={() => setGewaehlt(slug)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors"
              style={{
                borderColor: aktiv ? `var(--n-${c.necessity})` : "var(--border-strong)",
                background: aktiv
                  ? `color-mix(in srgb, var(--n-${c.necessity}) 12%, transparent)`
                  : "transparent",
              }}
            >
              <span aria-hidden>{c.icon}</span>
              {c.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setOffen((o) => !o)}
          className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--text-secondary)]"
          aria-expanded={offen}
        >
          {offen ? "Weniger" : "Andere…"}
        </button>
      </div>

      {offen && (
        <div className="mt-3 flex flex-col gap-3 border-t border-[var(--border)] pt-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-secondary)]">Alle Kategorien</span>
            <select
              name="kategorie"
              defaultValue={gewaehlt}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            >
              <option value="">— wählen —</option>
              {gruppiert().map(([gruppe, liste]) => (
                <optgroup key={gruppe} label={gruppenName(gruppe)}>
                  {liste.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.icon} {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auchMarke" className="size-4" />
            <span className="text-[var(--text-secondary)]">
              Auch für andere Filialen derselben Marke merken
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--text-secondary)]">
              Notwendigkeit abweichend einstufen (optional)
            </span>
            <select
              name="notwendigkeit"
              defaultValue=""
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            >
              <option value="">Standard der Kategorie</option>
              <option value="fix">Gebunden</option>
              <option value="noetig">Nötig</option>
              <option value="freiwillig">Freiwillig</option>
            </select>
          </label>

          <button
            type="submit"
            className="rounded-lg bg-[var(--n-fix)] px-4 py-2 text-sm font-medium text-white"
          >
            Übernehmen
          </button>
        </div>
      )}

      {/* Standardmässig merken — genau das spart die Arbeit beim nächsten Mal. */}
      <input type="hidden" name="merken" value="true" />
    </form>
  );
}

/**
 * Wahrscheinlichste Kategorien zuerst.
 *
 * Nutzt den Hinweis des Kartenherausgebers und die Richtung der Buchung.
 * Bei einer Zahlung an eine Privatperson stehen die typischen Anlässe oben —
 * geteilte Rechnungen sind fast immer Essen oder Ausgehen.
 */
function schnellauswahl(b: OffeneBuchung, istEinnahme: boolean): string[] {
  if (istEinnahme) return ["erstattung", "lohn", "familie", "einkommen_sonstig"];

  if (b.categorySlug && CATEGORY_BY_SLUG.has(b.categorySlug)) {
    const rest = ["auswaerts", "lebensmittel", "shopping", "mobilitaet"].filter(
      (s) => s !== b.categorySlug,
    );
    return [b.categorySlug, ...rest].slice(0, 4);
  }
  return ["auswaerts", "lebensmittel", "ausgehen", "shopping"];
}

function gruppiert(): Array<[string, typeof CATEGORIES]> {
  const map = new Map<string, typeof CATEGORIES>();
  for (const c of CATEGORIES) {
    const liste = map.get(c.group) ?? [];
    liste.push(c);
    map.set(c.group, liste);
  }
  return [...map.entries()];
}

function gruppenName(g: string): string {
  return (
    {
      fix: "Fixkosten", variabel: "Nötig, aber steuerbar", freiwillig: "Freiwillig",
      neutral: "Keine echte Ausgabe", einkommen: "Einnahmen",
    }[g] ?? g
  );
}
