"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Target, Receipt, Upload } from "lucide-react";

/**
 * Navigation.
 *
 * Auf dem Handy unten (Daumenreichweite), auf dem Desktop links als Leiste.
 * Dieselbe Komponente für beides — zwei getrennte Navigationen würden
 * unweigerlich auseinanderlaufen.
 */

const PUNKTE = [
  { href: "/",              label: "Übersicht",  icon: LayoutDashboard },
  { href: "/pruefen",       label: "Prüfen",     icon: ListChecks },
  { href: "/budget",        label: "Budget",     icon: Target },
  { href: "/buchungen",     label: "Buchungen",  icon: Receipt },
  { href: "/import",        label: "Import",     icon: Upload },
];

export function Nav({ offeneAnzahl = 0 }: { offeneAnzahl?: number }) {
  const pfad = usePathname();
  const aktiv = (href: string) => (href === "/" ? pfad === "/" : pfad.startsWith(href));

  return (
    <>
      {/* Handy: feste Leiste am unteren Rand */}
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface-1)]/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-5">
          {PUNKTE.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={aktiv(href) ? "page" : undefined}
                className="relative flex flex-col items-center gap-1 py-2.5 text-[11px]"
                style={{ color: aktiv(href) ? "var(--n-fix)" : "var(--text-muted)" }}
              >
                <Icon size={20} strokeWidth={aktiv(href) ? 2.4 : 1.8} />
                {label}
                {href === "/pruefen" && offeneAnzahl > 0 && <Zaehler n={offeneAnzahl} />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Desktop: Leiste links */}
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-[var(--border)] bg-[var(--surface-1)] px-3 py-5 sm:flex"
      >
        <div className="mb-6 px-2">
          <p className="text-lg font-semibold tracking-tight">Finanzen</p>
          <p className="text-xs text-[var(--text-muted)]">Lohnkonto & Karte</p>
        </div>
        <ul className="flex flex-col gap-1">
          {PUNKTE.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={aktiv(href) ? "page" : undefined}
                className="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
                style={{
                  background: aktiv(href) ? "var(--surface-2)" : "transparent",
                  color: aktiv(href) ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: aktiv(href) ? 600 : 400,
                }}
              >
                <Icon size={18} strokeWidth={aktiv(href) ? 2.2 : 1.8} />
                {label}
                {href === "/pruefen" && offeneAnzahl > 0 && (
                  <span className="ml-auto rounded-full bg-[var(--n-freiwillig)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {offeneAnzahl}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-1">
          <Link
            href="/einstellungen"
            className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          >
            Einstellungen
          </Link>
        </div>
      </nav>
    </>
  );
}

function Zaehler({ n }: { n: number }) {
  return (
    <span className="absolute top-1 right-[22%] min-w-4 rounded-full bg-[var(--n-freiwillig)] px-1 text-[10px] leading-4 font-semibold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}
