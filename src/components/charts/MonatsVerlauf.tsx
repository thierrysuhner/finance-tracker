"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { formatRappen } from "@/core/money";
import { monatName } from "@/components/ui";

/**
 * Ausgabenverlauf, gestapelt nach Notwendigkeit.
 *
 * Die Stapelung ist die Aussage: unten das Gebundene, oben das Freiwillige.
 * Man sieht auf einen Blick, wie viel Spielraum ein Monat überhaupt hatte —
 * eine reine Gesamtsumme verbirgt genau das.
 *
 * BEWUSST OHNE EINNAHMEN: eine einzelne Nachzahlung von 12'000 Franken im
 * Januar streckt die Achse so weit, dass alle Ausgabenbalken auf wenige Pixel
 * zusammenfallen — gemessen waren es 19 Pixel bei 258 Pixeln Diagrammhöhe.
 * Eine zweite Y-Achse würde das kaschieren, aber um den Preis, dass der
 * Schnittpunkt beider Kurven frei wählbar und damit bedeutungslos wird.
 * Einnahmen und Saldo stehen deshalb in einem eigenen Diagramm.
 */

export interface VerlaufPunkt {
  monat: string;
  fix: number;
  noetig: number;
  freiwillig: number;
  einnahmen: number;
}

const SERIEN = [
  { key: "fix",        label: "Gebunden",   farbe: "var(--n-fix)" },
  { key: "noetig",     label: "Nötig",      farbe: "var(--n-noetig)" },
  { key: "freiwillig", label: "Freiwillig", farbe: "var(--n-freiwillig)" },
] as const;

function kurzMonat(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  return new Date(j, mo - 1).toLocaleDateString("de-CH", { month: "short" });
}

function franken(rappen: number): string {
  return `${Math.round(rappen / 100)}`;
}

export function MonatsVerlauf({ daten }: { daten: VerlaufPunkt[] }) {
  if (daten.length === 0) return null;

  return (
    <div>
      {/*
        Legende als gewöhnliches HTML statt über Recharts. Grund: die
        Reihenfolge muss der Stapelung entsprechen (oben im Balken = links in
        der Legende), und Recharts gibt sie in Version 3 nicht mehr vor.
        Nebeneffekt: Bildschirmleser bekommen eine echte Liste.
      */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {[...SERIEN].reverse().map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: s.farbe }}
            />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daten} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="0"
            />
            <XAxis
              dataKey="monat"
              tickFormatter={kurzMonat}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={franken}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={<EigenerTooltip />}
            />
            {SERIEN.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="ausgaben"
                fill={s.farbe}
                // 2px Abstand zwischen den Segmenten, damit die Grenzen auch
                // bei ähnlicher Helligkeit sichtbar bleiben.
                stroke="var(--surface-1)"
                strokeWidth={2}
                radius={i === SERIEN.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={56}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Beträge in CHF</p>
    </div>
  );
}

function EigenerTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const ausgaben = payload.reduce((a: number, p: any) => a + (p.value ?? 0), 0);

  return (
    <div className="karte min-w-52 p-3 text-sm">
      <p className="mb-2 font-medium">{monatName(label)}</p>
      <ul className="flex flex-col gap-1">
        {payload.map((p: any) => (
          <li key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
            <span className="tabular font-medium">{formatRappen(p.value ?? 0)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-2">
        <span className="text-[var(--text-secondary)]">Ausgaben total</span>
        <span className="tabular font-semibold">{formatRappen(ausgaben)}</span>
      </div>
    </div>
  );
}
