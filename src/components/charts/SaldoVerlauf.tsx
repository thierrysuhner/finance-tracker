"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell,
} from "recharts";
import { formatRappen } from "@/core/money";
import { monatName } from "@/components/ui";

/**
 * Saldo je Monat: Einnahmen minus Ausgaben.
 *
 * Eigenes Diagramm statt einer zweiten Achse im Ausgabendiagramm. Der Saldo
 * hat eine echte Polarität — Überschuss oder Fehlbetrag —, und die trägt hier
 * die Balkenrichtung. Die Farbe verstärkt sie nur; wer sie nicht unterscheiden
 * kann, liest die Aussage trotzdem an der Richtung ab.
 */

export interface SaldoPunkt {
  monat: string;
  einnahmen: number;
  ausgaben: number;
}

function kurzMonat(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  return new Date(j, mo - 1).toLocaleDateString("de-CH", { month: "short" });
}

export function SaldoVerlauf({ daten }: { daten: SaldoPunkt[] }) {
  const punkte = daten.map((d) => ({
    monat: d.monat,
    saldo: d.einnahmen - d.ausgaben,
    einnahmen: d.einnahmen,
    ausgaben: d.ausgaben,
  }));

  if (punkte.length === 0) return null;

  return (
    <div>
      <div className="h-44 w-full sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={punkte} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="monat"
              tickFormatter={kurzMonat}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(v) => String(Math.round(v / 100))}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<SaldoTooltip />} />
            <Bar dataKey="saldo" name="Saldo" maxBarSize={44} radius={[3, 3, 0, 0]}>
              {punkte.map((p) => (
                <Cell
                  key={p.monat}
                  fill={p.saldo >= 0 ? "var(--n-fix)" : "var(--danger)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Balken nach oben: mehr eingenommen als ausgegeben. Beträge in CHF.
      </p>
    </div>
  );
}

function SaldoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="karte min-w-52 p-3 text-sm">
      <p className="mb-2 font-medium">{monatName(label)}</p>
      <dl className="flex flex-col gap-1">
        <Zeile label="Einnahmen" wert={p.einnahmen} />
        <Zeile label="Ausgaben" wert={-p.ausgaben} />
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-1.5">
          <dt className="text-[var(--text-secondary)]">Saldo</dt>
          <dd
            className="tabular font-semibold"
            style={{ color: p.saldo >= 0 ? "var(--good)" : "var(--danger)" }}
          >
            {formatRappen(p.saldo, { sign: true })}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Zeile({ label, wert }: { label: string; wert: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd className="tabular">{formatRappen(wert, { sign: true })}</dd>
    </div>
  );
}
