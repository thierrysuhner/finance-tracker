import { formatRappen } from "@/core/money";
import { farbe, NOTWENDIGKEIT_LABEL } from "@/components/ui";
import type { Necessity } from "@/core/types";

/**
 * Der wichtigste Blick des ganzen Werkzeugs: wie viel des Monats war
 * überhaupt beeinflussbar?
 *
 * Ein Segment pro Notwendigkeitsstufe, jedes direkt beschriftet. Die
 * Beschriftung steht bewusst nicht nur in der Legende — auf hellem Grund
 * erreicht die Aqua-Fläche keinen 3:1-Kontrast, deshalb muss die Bedeutung
 * auch ohne Farberkennung ablesbar sein.
 */

export function NotwendigkeitsBalken({
  werte, gesamt,
}: {
  werte: Record<Necessity, number>;
  gesamt: number;
}) {
  const stufen: Necessity[] = ["fix", "noetig", "freiwillig"];
  const summe = Math.abs(gesamt) || 1;

  const teile = stufen
    .map((s) => ({
      stufe: s,
      betrag: Math.abs(werte[s] ?? 0),
      anteil: Math.abs(werte[s] ?? 0) / summe,
    }))
    .filter((t) => t.betrag > 0);

  if (teile.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Noch keine Ausgaben erfasst.</p>;
  }

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {teile.map((t) => (
          <div
            key={t.stufe}
            style={{ width: `${t.anteil * 100}%`, background: farbe(t.stufe) }}
            title={`${NOTWENDIGKEIT_LABEL[t.stufe]}: ${formatRappen(t.betrag)} CHF`}
          />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {stufen.map((s) => {
          const betrag = Math.abs(werte[s] ?? 0);
          return (
            <div key={s}>
              <dt className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: farbe(s) }}
                />
                {NOTWENDIGKEIT_LABEL[s]}
              </dt>
              <dd className="tabular mt-0.5 font-semibold">{formatRappen(betrag)}</dd>
              <dd className="text-xs text-[var(--text-muted)]">
                {Math.round((betrag / summe) * 100)}%
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
