import { formatRappen } from "@/core/money";
import type { Necessity } from "@/core/types";
import type { ReactNode } from "react";

/** Wiederverwendbare Bausteine. Bewusst klein gehalten. */

export function Karte({
  children, className = "", padding = true,
}: { children: ReactNode; className?: string; padding?: boolean }) {
  return (
    <section className={`karte ${padding ? "p-4 sm:p-5" : ""} ${className}`}>{children}</section>
  );
}

export function KartenTitel({ children, hinweis }: { children: ReactNode; hinweis?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
        {children}
      </h2>
      {hinweis && <span className="text-xs text-[var(--text-muted)]">{hinweis}</span>}
    </div>
  );
}

/**
 * Geldbetrag.
 *
 * Ausgaben werden nicht rot eingefärbt: bei einem Ausgabentracker ist fast
 * alles eine Ausgabe, flächiges Rot würde nur Lärm erzeugen und die Stellen
 * entwerten, wo eine Warnung wirklich gemeint ist.
 */
export function Betrag({
  rappen, gross = false, vorzeichen = false, className = "",
}: { rappen: number; gross?: boolean; vorzeichen?: boolean; className?: string }) {
  return (
    <span
      className={`tabular ${gross ? "text-2xl font-semibold sm:text-3xl" : ""} ${className}`}
    >
      {formatRappen(rappen, { sign: vorzeichen })}
      <span className="ml-1 text-[0.7em] font-normal text-[var(--text-muted)]">CHF</span>
    </span>
  );
}

const NOTWENDIGKEIT_FARBE: Record<Necessity, string> = {
  fix: "var(--n-fix)",
  noetig: "var(--n-noetig)",
  freiwillig: "var(--n-freiwillig)",
  neutral: "var(--n-neutral)",
};

export const NOTWENDIGKEIT_LABEL: Record<Necessity, string> = {
  fix: "Gebunden",
  noetig: "Nötig",
  freiwillig: "Freiwillig",
  neutral: "Neutral",
};

export function farbe(n: Necessity): string {
  return NOTWENDIGKEIT_FARBE[n];
}

/** Kleiner Farbpunkt — trägt die Bedeutung nie allein, steht immer neben Text. */
export function Punkt({ necessity }: { necessity: Necessity }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: farbe(necessity) }}
    />
  );
}

export function Etikett({
  necessity, children,
}: { necessity: Necessity; children?: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: farbe(necessity),
        background: `color-mix(in srgb, ${farbe(necessity)} 12%, transparent)`,
      }}
    >
      <Punkt necessity={necessity} />
      {children ?? NOTWENDIGKEIT_LABEL[necessity]}
    </span>
  );
}

/** Waagrechter Anteilsbalken mit direkter Beschriftung. */
export function Balken({
  anteil, necessity, hoehe = 8,
}: { anteil: number; necessity: Necessity; hoehe?: number }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
      style={{ height: hoehe }}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${Math.min(100, Math.max(0, anteil * 100))}%`,
          background: farbe(necessity),
        }}
      />
    </div>
  );
}

export function Leer({ titel, text, aktion }: { titel: string; text: string; aktion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{titel}</p>
      <p className="max-w-sm text-sm text-[var(--text-secondary)]">{text}</p>
      {aktion}
    </div>
  );
}

export function monatName(monat: string): string {
  const [j, m] = monat.split("-").map(Number);
  return new Date(j, m - 1, 1).toLocaleDateString("de-CH", {
    month: "long", year: "numeric",
  });
}

export function kurzDatum(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}
