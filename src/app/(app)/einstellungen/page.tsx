import { getJsonSetting, getSetting, getSqlite, SETTING_KEYS } from "@/db";
import { speichereEinstellungen, abmelden, speichereKi } from "@/app/actions";
import { DEFAULT_REVIEW_THRESHOLD } from "@/core/categorize/engine";
import { Karte, KartenTitel } from "@/components/ui";
import { PasswortFormular } from "./PasswortFormular";

export const dynamic = "force-dynamic";

export default async function Einstellungen() {
  const namen = getJsonSetting<string[]>(SETTING_KEYS.ownNames, []);
  const ibans = getJsonSetting<string[]>(SETTING_KEYS.ownIbans, []);
  const schwelle = Number(getSetting(SETTING_KEYS.reviewThreshold)) || DEFAULT_REVIEW_THRESHOLD;

  const gelernt = (
    getSqlite().prepare("SELECT COUNT(*) n FROM merchant_memory").get() as { n: number }
  ).n;

  const kiAnbieter = getSetting(SETTING_KEYS.aiProvider);
  // Der Schlüssel selbst wird nie ins Formular zurückgegeben, nur ob einer da ist.
  const kiSchluessel = Boolean(getSetting(SETTING_KEYS.aiApiKey));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Einstellungen</h1>
      </header>

      <Karte>
        <KartenTitel hinweis="damit Umbuchungen nicht als Ausgabe zählen">
          Eigene Konten
        </KartenTitel>
        <form action={speichereEinstellungen} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm">Namen, unter denen du dir selbst überweist</span>
            <span className="text-xs text-[var(--text-muted)]">
              Eine Zeile pro Eintrag. Überweisungen an dein Anlagekonto laufen oft unter
              deinem eigenen Namen oder dem Kürzel deiner Bank. Was hier steht, wird als
              Umbuchung behandelt und taucht in keiner Ausgabenstatistik auf.
            </span>
            <textarea
              name="eigeneNamen"
              rows={3}
              defaultValue={namen.join("\n")}
              placeholder={"Vorname Nachname\nHBL Meisterschwanden"}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm">Eigene IBAN</span>
            <span className="text-xs text-[var(--text-muted)]">
              Eine Zeile pro Konto. Zuverlässiger als der Name, wird aber nur bei
              Überweisungen mitgeliefert.
            </span>
            <textarea
              name="eigeneIbans"
              rows={2}
              defaultValue={ibans.join("\n")}
              placeholder="CH00 0000 0000 0000 0000 0"
              className="tabular rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm">Wann soll nachgefragt werden?</span>
            <span className="text-xs text-[var(--text-muted)]">
              Höher heisst vorsichtiger: es wird öfter gefragt, dafür sind die
              automatischen Zuordnungen verlässlicher. Standard ist 0.75.
            </span>
            <input
              type="number"
              name="schwelle"
              min="0.3"
              max="1"
              step="0.05"
              defaultValue={schwelle}
              className="tabular w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            className="self-start rounded-lg bg-[var(--n-fix)] px-4 py-2 text-sm font-medium text-white"
          >
            Speichern
          </button>
        </form>
      </Karte>

      <Karte>
        <KartenTitel>Gelernte Zuordnungen</KartenTitel>
        <p className="text-sm text-[var(--text-secondary)]">
          Das Tool kennt inzwischen{" "}
          <span className="font-semibold text-[var(--text-primary)]">{gelernt}</span>{" "}
          Händler und Marken. Jede Zuordnung, die du bestätigst, kommt dazu — beim
          nächsten Import wird dann nicht mehr gefragt.
        </p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Diese Zuordnungen liegen ausschliesslich in deiner Datenbankdatei, nie im
          Programmcode. Namen von Personen verlassen dein Gerät nicht.
        </p>
      </Karte>

      <Karte>
        <KartenTitel hinweis="optional">KI für unbekannte Händler</KartenTitel>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Ohne Schlüssel funktioniert alles wie gewohnt — die Zuordnung läuft dann rein
          über Regelwerk und Gedächtnis. Ist ein Schlüssel hinterlegt, werden beim Import
          nur die <span className="font-medium">Namen</span> unbekannter Händler angefragt,
          niemals Beträge, Daten oder Namen von Privatpersonen. Vorschläge der KI werden
          dir trotzdem zur Bestätigung vorgelegt.
        </p>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Kostenlos möglich mit Google AI Studio (Gemini Flash) oder Groq — beide haben ein
          Gratis-Kontingent, das für ein paar Dutzend Händler im Monat reicht.
        </p>
        <form action={speichereKi} className="flex max-w-md flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--text-secondary)]">Anbieter</span>
            <select
              name="anbieter"
              defaultValue={kiAnbieter ?? ""}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            >
              <option value="">Aus — nur lokale Zuordnung</option>
              <option value="google">Google AI Studio (Gemini)</option>
              <option value="groq">Groq</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--text-secondary)]">API-Schlüssel</span>
            <input
              type="password"
              name="apiKey"
              placeholder={
                kiSchluessel ? "hinterlegt — leer lassen, um ihn zu behalten" : "noch keiner hinterlegt"
              }
              autoComplete="off"
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="self-start rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium"
          >
            Speichern
          </button>
        </form>
      </Karte>

      <Karte>
        <KartenTitel>Passwort ändern</KartenTitel>
        <PasswortFormular />
      </Karte>

      <Karte>
        <KartenTitel>Sitzung</KartenTitel>
        <form action={abmelden}>
          <button
            type="submit"
            className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium"
          >
            Abmelden
          </button>
        </form>
      </Karte>
    </div>
  );
}
