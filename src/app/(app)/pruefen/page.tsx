import { offeneBuchungen, offeneEingaenge, ausgabenUm } from "@/server/queries";
import { findeOffsetKandidaten } from "@/core/offset/matcher";
import { Karte, KartenTitel, Leer } from "@/components/ui";
import { ZuordnungsKarte } from "./ZuordnungsKarte";
import { VerrechnungsKarte } from "./VerrechnungsKarte";
import { formatRappen } from "@/core/money";

export const dynamic = "force-dynamic";

/**
 * Die Nachfrage-Liste.
 *
 * Zwei Arten von Fragen, bewusst getrennt:
 *
 *   Verrechnungen  Ein Geldeingang, der zu einer früheren Ausgabe gehört.
 *                  Steht oben, weil eine Verrechnung gleich zwei Buchungen
 *                  erledigt und die Zahlen stärker korrigiert.
 *   Zuordnungen    Eine Ausgabe ohne sichere Kategorie.
 *
 * Beides nach Betrag sortiert: wer nur fünf Minuten hat, soll mit den
 * wirksamsten anfangen.
 */
export default async function Pruefen() {
  const offen = await offeneBuchungen(150);
  const eingaenge = await offeneEingaenge();

  // Zu jedem Geldeingang die plausiblen Gegenstücke suchen.
  // Zu jedem Eingang die Kandidaten holen. Bewusst sequenziell mit einem
  // gemeinsamen Zwischenspeicher je Datum: sonst würde für jeden der bis zu
  // hundert Eingänge dieselbe Abfrage erneut über das Netz gehen.
  const kandidatenCache = new Map<string, Awaited<ReturnType<typeof ausgabenUm>>>();
  async function ausgabenFuer(datum: string) {
    let liste = kandidatenCache.get(datum);
    if (!liste) {
      liste = await ausgabenUm(datum, 120);
      kandidatenCache.set(datum, liste);
    }
    return liste;
  }

  const verrechnungen: Array<{
    eingang: (typeof eingaenge)[number];
    kandidaten: ReturnType<typeof findeOffsetKandidaten>;
    ausgaben: Awaited<ReturnType<typeof ausgabenUm>>;
  }> = [];

  for (const e of eingaenge) {
    const ausgaben = await ausgabenFuer(e.bookingDate);
    const kandidaten = findeOffsetKandidaten(
      { id: e.id, bookingDate: e.bookingDate, amount: e.amount, counterparty: e.counterparty },
      ausgaben,
    );
    if (kandidaten.length > 0) verrechnungen.push({ eingang: e, kandidaten, ausgaben });
  }
  verrechnungen.sort((a, b) => b.eingang.amount - a.eingang.amount);

  const zuVerrechnenIds = new Set(verrechnungen.map((v) => v.eingang.id));
  const zuOrdnen = offen.filter((o) => !zuVerrechnenIds.has(o.id));

  const summeOffen = zuOrdnen.reduce((a, o) => a + Math.abs(o.amount), 0);

  if (zuOrdnen.length === 0 && verrechnungen.length === 0) {
    return (
      <Karte>
        <Leer
          titel="Alles zugeordnet"
          text="Es gibt gerade nichts zu entscheiden. Nach dem nächsten Import erscheinen hier die neuen Buchungen, die das Tool nicht sicher einordnen konnte."
        />
      </Karte>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Prüfen</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {zuOrdnen.length} Zuordnungen
          {verrechnungen.length > 0 && ` · ${verrechnungen.length} mögliche Verrechnungen`}
          {summeOffen > 0 && ` · ${formatRappen(summeOffen)} CHF betroffen`}
        </p>
      </header>

      {verrechnungen.length > 0 && (
        <section>
          <KartenTitel hinweis="erledigt zwei Buchungen auf einmal">
            Geld zurückbekommen?
          </KartenTitel>
          <div className="flex flex-col gap-3">
            {verrechnungen.slice(0, 20).map((v) => (
              <VerrechnungsKarte
                key={v.eingang.id}
                eingang={v.eingang}
                kandidaten={v.kandidaten}
                ausgaben={v.ausgaben}
              />
            ))}
          </div>
        </section>
      )}

      {zuOrdnen.length > 0 && (
        <section>
          <KartenTitel hinweis="grösste zuerst">Kategorie festlegen</KartenTitel>
          <div className="flex flex-col gap-3">
            {zuOrdnen.slice(0, 60).map((b) => (
              <ZuordnungsKarte key={b.id} buchung={b} />
            ))}
          </div>
          {zuOrdnen.length > 60 && (
            <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
              Noch {zuOrdnen.length - 60} weitere — sie erscheinen, sobald diese erledigt sind.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
