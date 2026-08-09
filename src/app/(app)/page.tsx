import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import {
  monatsUebersicht, monatsReihe, verfuegbareMonate, topHaendler, anzahlBuchungen,
} from "@/server/queries";
import { budgetVergleich } from "@/server/budget";
import { formatRappen, median } from "@/core/money";
import { Karte, KartenTitel, Betrag, Etikett, Leer, monatName } from "@/components/ui";
import { NotwendigkeitsBalken } from "@/components/NotwendigkeitsBalken";
import { MonatsVerlauf } from "@/components/charts/MonatsVerlauf";
import { SaldoVerlauf } from "@/components/charts/SaldoVerlauf";
import { MonatsWahl } from "@/components/MonatsWahl";
import { CATEGORY_BY_SLUG } from "@/core/categorize/categories";

export const dynamic = "force-dynamic";

export default async function Uebersicht({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const { monat: gewaehlt } = await searchParams;

  if (anzahlBuchungen() === 0) {
    return (
      <Karte>
        <Leer
          titel="Noch keine Daten"
          text="Lade deinen Kontoauszug aus dem E-Banking und den Kartenexport von Swisscard hoch. Danach siehst du hier deine Auswertung."
          aktion={
            <Link
              href="/import"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--n-fix)] px-4 py-2 text-sm font-medium text-white"
            >
              Dateien importieren <ArrowRight size={16} />
            </Link>
          }
        />
      </Karte>
    );
  }

  const monate = verfuegbareMonate();
  const monat = gewaehlt && monate.includes(gewaehlt) ? gewaehlt : monate[0];

  const u = monatsUebersicht(monat);
  const reihe = monatsReihe();
  const haendler = topHaendler(monat, 6);
  const budgets = budgetVergleich(monat);

  // Vergleich mit dem typischen Monat, damit die Zahl einen Massstab bekommt.
  const abgeschlossene = reihe.filter((p) => p.monat !== monat && p.ausgaben > 0);
  const typisch = median(abgeschlossene.map((p) => p.ausgaben));
  const aktuell = Math.abs(u.ausgaben);

  /*
   * Läuft der Monat noch, wäre ein direkter Vergleich mit dem Median grob
   * irreführend: am 6. August "89% unter dem Durchschnitt" zu vermelden sagt
   * nur, dass der Monat jung ist. Deshalb wird auf den Monatsverlauf
   * hochgerechnet, bevor verglichen wird — und das wird auch dazugeschrieben.
   */
  const heute = new Date();
  const laeuftNoch = heute.toISOString().slice(0, 7) === monat;
  const [jahr, monNr] = monat.split("-").map(Number);
  const tageImMonat = new Date(jahr, monNr, 0).getDate();
  const tagHeute = Math.min(heute.getDate(), tageImMonat);
  const vergleichsWert = laeuftNoch
    ? Math.round((aktuell / tagHeute) * tageImMonat)
    : aktuell;
  const abweichung = typisch > 0 ? (vergleichsWert - typisch) / typisch : 0;

  const budgetSumme = budgets.reduce((a, b) => a + (b.budget ?? 0), 0);
  const hochrechnung = budgets.reduce((a, b) => a + b.hochrechnung, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {monatName(monat)}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {u.kategorien.reduce((a, k) => a + k.anzahl, 0)} Buchungen
          </p>
        </div>
        <MonatsWahl monate={monate} aktiv={monat} />
      </header>

      {u.offeneAnzahl > 0 && (
        <Link
          href="/pruefen"
          className="karte flex items-center gap-3 p-4 transition-colors hover:bg-[var(--surface-2)]"
        >
          <TriangleAlert size={20} style={{ color: "var(--n-freiwillig)" }} />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {u.offeneAnzahl} {u.offeneAnzahl === 1 ? "Buchung braucht" : "Buchungen brauchen"} eine Zuordnung
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Bis dahin sind die Zahlen unten unvollständig.
            </p>
          </div>
          <ArrowRight size={18} className="text-[var(--text-muted)]" />
        </Link>
      )}

      {/* ── Kennzahlen ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Karte>
          <p className="text-xs tracking-wide text-[var(--text-secondary)] uppercase">
            Ausgaben
          </p>
          <p className="mt-1">
            <Betrag rappen={aktuell} gross />
          </p>
          {typisch > 0 && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {laeuftNoch && (
                <>
                  Hochgerechnet{" "}
                  <span className="tabular font-semibold text-[var(--text-primary)]">
                    {formatRappen(vergleichsWert, { decimals: false })}
                  </span>{" "}
                  bis Monatsende ·{" "}
                </>
              )}
              {Math.abs(abweichung) < 0.05 ? (
                "wie in einem typischen Monat"
              ) : (
                <>
                  <span
                    style={{
                      color: abweichung > 0 ? "var(--n-freiwillig)" : "var(--good)",
                      fontWeight: 600,
                    }}
                  >
                    {abweichung > 0 ? "+" : "−"}
                    {Math.abs(Math.round(abweichung * 100))}%
                  </span>{" "}
                  gegenüber dem Median von {formatRappen(typisch, { decimals: false })}
                </>
              )}
            </p>
          )}
          {laeuftNoch && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Tag {tagHeute} von {tageImMonat} — der Monat läuft noch.
            </p>
          )}
        </Karte>

        <Karte>
          <p className="text-xs tracking-wide text-[var(--text-secondary)] uppercase">
            Einnahmen
          </p>
          <p className="mt-1">
            <Betrag rappen={u.einnahmen} gross />
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Saldo{" "}
            <span
              className="tabular font-semibold"
              style={{ color: u.saldo >= 0 ? "var(--good)" : "var(--danger)" }}
            >
              {formatRappen(u.saldo, { sign: true })}
            </span>
          </p>
        </Karte>

        <Karte>
          <p className="text-xs tracking-wide text-[var(--text-secondary)] uppercase">
            {budgetSumme > 0 ? "Hochrechnung" : "Neutral gestellt"}
          </p>
          {budgetSumme > 0 ? (
            <>
              <p className="mt-1">
                <Betrag rappen={hochrechnung} gross />
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Budget {formatRappen(budgetSumme, { decimals: false })} —{" "}
                <span
                  style={{
                    color:
                      hochrechnung > budgetSumme ? "var(--n-freiwillig)" : "var(--good)",
                    fontWeight: 600,
                  }}
                >
                  {hochrechnung > budgetSumme ? "über" : "im Rahmen"}
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="mt-1">
                <Betrag rappen={Math.abs(u.neutralSumme)} gross />
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Eigenüberträge und Kartenausgleich — zählen nicht als Ausgabe
              </p>
            </>
          )}
        </Karte>
      </div>

      {/* ── Nötig gegen freiwillig ─────────────────────────────────────── */}
      <Karte>
        <KartenTitel hinweis="Wie viel war beeinflussbar?">
          Aufteilung nach Notwendigkeit
        </KartenTitel>
        <NotwendigkeitsBalken werte={u.nachNotwendigkeit} gesamt={u.ausgaben} />
      </Karte>

      {/* ── Verlauf ────────────────────────────────────────────────────── */}
      {reihe.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Karte>
            <KartenTitel hinweis={`${reihe.length} Monate`}>
              Ausgaben im Verlauf
            </KartenTitel>
            <MonatsVerlauf daten={reihe} />
          </Karte>
          <Karte>
            <KartenTitel hinweis="Einnahmen minus Ausgaben">Was übrig blieb</KartenTitel>
            <SaldoVerlauf daten={reihe} />
          </Karte>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Kategorien ───────────────────────────────────────────────── */}
        <Karte>
          <KartenTitel>Wohin das Geld ging</KartenTitel>
          <ul className="flex flex-col gap-3">
            {u.kategorien
              .filter((k) => k.betrag < 0)
              .slice(0, 8)
              .map((k) => {
                const anteil = Math.abs(k.betrag) / (Math.abs(u.ausgaben) || 1);
                return (
                  <li key={k.slug}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden>{k.icon}</span>
                        <span className="truncate">{k.label}</span>
                        <span className="shrink-0 text-xs text-[var(--text-muted)]">
                          {k.anzahl}×
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium">
                        {formatRappen(Math.abs(k.betrag))}
                      </span>
                    </div>
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="rounded-full"
                        style={{
                          width: `${anteil * 100}%`,
                          background: `var(--n-${k.necessity === "noetig" ? "noetig" : k.necessity})`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        </Karte>

        {/* ── Häufigste Gegenparteien ──────────────────────────────────── */}
        <Karte>
          <KartenTitel hinweis="im gewählten Monat">Wo am meisten zusammenkam</KartenTitel>
          {haendler.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Keine Ausgaben in diesem Monat.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {haendler.map((h) => {
                const def = h.kategorie ? CATEGORY_BY_SLUG.get(h.kategorie) : undefined;
                return (
                  <li
                    key={h.counterparty}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{h.counterparty}</p>
                      <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        {h.anzahl}× · {def?.label ?? "offen"}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-medium">
                      {formatRappen(Math.abs(h.betrag))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Karte>
      </div>

      {/* ── Muster, die sonst untergehen ───────────────────────────────── */}
      <KleinviehHinweis monat={monat} />
    </div>
  );
}

/**
 * Weist auf viele kleine Beträge beim gleichen Händler hin.
 *
 * Einzeln fällt so etwas nie auf — in Summe ist es oft der grösste Posten
 * einer Kategorie. Genau das soll ein Tracker sichtbar machen.
 */
async function KleinviehHinweis({ monat }: { monat: string }) {
  const alle = topHaendler(null, 60);
  const kandidat = alle
    .filter((h) => h.anzahl >= 10)
    .map((h) => ({ ...h, schnitt: Math.abs(h.betrag) / h.anzahl }))
    .filter((h) => h.schnitt < 1500)
    .sort((a, b) => a.betrag - b.betrag)[0];

  if (!kandidat) return null;

  return (
    <Karte>
      <KartenTitel hinweis="über den gesamten Zeitraum">Fällt einzeln nicht auf</KartenTitel>
      <p className="text-sm text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">{kandidat.counterparty}</span>{" "}
        taucht <span className="tabular font-medium">{kandidat.anzahl}×</span> auf, im Schnitt{" "}
        <span className="tabular">{formatRappen(Math.round(kandidat.schnitt))}</span> — zusammen{" "}
        <span className="tabular font-semibold text-[var(--text-primary)]">
          {formatRappen(Math.abs(kandidat.betrag))} CHF
        </span>
        .
      </p>
    </Karte>
  );
}
