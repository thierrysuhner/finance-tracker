"use client";

import { useState } from "react";
import { erfasseManuell } from "@/app/actions";
import { CATEGORIES } from "@/core/categorize/categories";

/**
 * Nacherfassung von Bargeld und Ausgaben über andere Konten.
 *
 * Auf dem Handy optimiert: Zahlenfeld mit Dezimaltastatur, Datum
 * vorausgefüllt auf heute, Kategorie als grosse Auswahl. Was länger als
 * zwanzig Sekunden dauert, wird im Alltag nicht gemacht.
 */
export function ErfassungsFormular() {
  const [meldung, setMeldung] = useState<string | null>(null);
  const heute = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={async (fd) => {
        const r = await erfasseManuell(fd);
        setMeldung(r?.fehler ?? (r?.ok ? "Erfasst." : null));
        if (r?.ok) {
          (document.getElementById("erfassung") as HTMLFormElement | null)?.reset();
        }
      }}
      id="erfassung"
      className="grid gap-3 sm:grid-cols-[7rem_1fr_10rem_auto]"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-secondary)]">Betrag</span>
        <input
          type="text"
          inputMode="decimal"
          name="betrag"
          required
          placeholder="24.50"
          className="tabular rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-secondary)]">Wofür</span>
        <input
          type="text"
          name="beschreibung"
          placeholder="Kaffee, Marktstand, …"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--text-secondary)]">Kategorie</span>
        <select
          name="kategorie"
          required
          defaultValue="auswaerts"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
        >
          {CATEGORIES.filter((c) => c.group !== "neutral").map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-[var(--text-secondary)]">Datum</span>
          <input
            type="date"
            name="datum"
            required
            defaultValue={heute}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[var(--n-fix)] px-4 py-2 text-sm font-medium text-white"
        >
          Hinzufügen
        </button>
      </div>

      <input type="hidden" name="konto" value="Bargeld" />

      {meldung && (
        <p className="text-sm text-[var(--text-secondary)] sm:col-span-4">{meldung}</p>
      )}
    </form>
  );
}
