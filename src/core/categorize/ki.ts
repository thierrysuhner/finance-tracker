import type { CategorySuggestion, ParsedTransaction } from "../types";
import { AUSGABEN_KATEGORIEN, EINKOMMEN_KATEGORIEN } from "./categories";

/**
 * Optionaler KI-Fallback für Händler, die weder Regelwerk noch Gedächtnis kennt.
 *
 * Bewusste Gestaltung:
 *
 * ABSCHALTBAR. Ohne Schlüssel läuft alles wie zuvor. Die Kategorisierung
 * funktioniert vollständig ohne KI — sie erreicht auf echten Kontodaten schon
 * ohne diese Stufe den Grossteil. Die KI ist Komfort, keine Voraussetzung.
 *
 * SPARSAM. Angefragt wird nur der Händlername, nie der Betrag, nie das Datum,
 * nie die Gegenpartei bei Privatpersonen. Ein Anbieter erfährt damit
 * höchstens, dass jemand in einem bestimmten Laden war — nicht wofür wie viel.
 *
 * GEBÜNDELT. Bis zu 40 unbekannte Händler gehen in einer einzigen Anfrage
 * raus. Das hält den Import schnell und bleibt bequem im kostenlosen
 * Kontingent der Anbieter.
 *
 * MISSTRAUISCH. Das Ergebnis erhält höchstens Konfidenz 0.7 und liegt damit
 * unter der Nachfrage-Schwelle: ein Vorschlag der KI wird immer noch
 * bestätigt, bevor er die Auswertung beeinflusst.
 */

export type KiAnbieter = "google" | "groq";

export interface KiKonfiguration {
  anbieter: KiAnbieter;
  apiKey: string;
  modell?: string;
}

/** Nur diese Angaben verlassen das Gerät. */
interface AnfrageEintrag {
  name: string;
  hinweis?: string;
}

const ENDPUNKTE: Record<KiAnbieter, { url: (m: string) => string; standardModell: string }> = {
  google: {
    standardModell: "gemini-2.0-flash",
    url: (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  },
  groq: {
    standardModell: "llama-3.3-70b-versatile",
    url: () => "https://api.groq.com/openai/v1/chat/completions",
  },
};

function bauePrompt(eintraege: AnfrageEintrag[]): string {
  const kategorien = [...AUSGABEN_KATEGORIEN, ...EINKOMMEN_KATEGORIEN]
    .map((c) => `${c.slug} = ${c.label}`)
    .join("\n");

  return [
    "Du ordnest Zahlungsempfänger aus einem Schweizer Bankauszug einer Ausgabenkategorie zu.",
    "",
    "Verfügbare Kategorien:",
    kategorien,
    "",
    "Regeln:",
    "- Antworte ausschliesslich mit JSON, ohne Fliesstext und ohne Code-Zaun.",
    '- Format: [{"name":"<eingabename>","slug":"<kategorie>","sicher":true|false}]',
    "- Kennst du den Empfänger nicht sicher, setze sicher auf false.",
    "- Verwende ausschliesslich Kategorien aus der Liste.",
    "- Schweizer Kontext: Coop und Migros sind Lebensmittelhändler, SBB ist öffentlicher Verkehr,",
    "  ein Restaurant im Migros gehört zu auswaerts, eine Migrol-Tankstelle zu mobilitaet.",
    "",
    "Empfänger:",
    ...eintraege.map((e, i) => `${i + 1}. ${e.name}${e.hinweis ? ` (Hinweis: ${e.hinweis})` : ""}`),
  ].join("\n");
}

function parseAntwort(text: string): Map<string, { slug: string; sicher: boolean }> {
  const ergebnis = new Map<string, { slug: string; sicher: boolean }>();

  // Modelle verpacken JSON gerne in Code-Zäune, obwohl man es verbietet.
  const bereinigt = text.replace(/```(?:json)?/gi, "").trim();
  const start = bereinigt.indexOf("[");
  const ende = bereinigt.lastIndexOf("]");
  if (start === -1 || ende === -1) return ergebnis;

  try {
    const daten = JSON.parse(bereinigt.slice(start, ende + 1));
    if (!Array.isArray(daten)) return ergebnis;

    const gueltig = new Set([...AUSGABEN_KATEGORIEN, ...EINKOMMEN_KATEGORIEN].map((c) => c.slug));
    for (const e of daten) {
      if (typeof e?.name !== "string" || typeof e?.slug !== "string") continue;
      // Erfundene Kategorien werden verworfen statt übernommen.
      if (!gueltig.has(e.slug)) continue;
      ergebnis.set(e.name.toLowerCase().trim(), { slug: e.slug, sicher: e.sicher === true });
    }
  } catch {
    // Unlesbare Antwort ist kein Fehlerfall — es bleibt beim Nachfragen.
  }
  return ergebnis;
}

/**
 * Fragt eine Kategorie für unbekannte Händler an.
 *
 * Wirft nie: fällt der Dienst aus oder ist das Kontingent erschöpft, bleibt
 * es einfach beim Nachfragen. Ein Import darf daran nicht scheitern.
 */
export async function frageKi(
  namen: string[],
  konfig: KiKonfiguration,
  opts: { timeoutMs?: number } = {},
): Promise<Map<string, { slug: string; sicher: boolean }>> {
  const leer = new Map<string, { slug: string; sicher: boolean }>();
  if (namen.length === 0 || !konfig.apiKey) return leer;

  const eintraege = namen.slice(0, 40).map((name) => ({ name }));
  const prompt = bauePrompt(eintraege);
  const modell = konfig.modell ?? ENDPUNKTE[konfig.anbieter].standardModell;
  const abbruch = AbortSignal.timeout(opts.timeoutMs ?? 20_000);

  try {
    let antwortText = "";

    if (konfig.anbieter === "google") {
      const res = await fetch(ENDPUNKTE.google.url(modell), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": konfig.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
        signal: abbruch,
      });
      if (!res.ok) return leer;
      const daten = await res.json();
      antwortText = daten?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      const res = await fetch(ENDPUNKTE.groq.url(modell), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${konfig.apiKey}`,
        },
        body: JSON.stringify({
          model: modell,
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
        signal: abbruch,
      });
      if (!res.ok) return leer;
      const daten = await res.json();
      antwortText = daten?.choices?.[0]?.message?.content ?? "";
    }

    return parseAntwort(antwortText);
  } catch {
    return leer;
  }
}

/**
 * Verbindet einen KI-Vorschlag mit dem bisherigen Ergebnis.
 *
 * Greift nur, wenn die Vorstufen nichts Brauchbares geliefert haben, und
 * bleibt immer unter der Nachfrage-Schwelle.
 */
export function mitKiErgaenzen(
  bisher: CategorySuggestion,
  tx: ParsedTransaction,
  kiErgebnis: Map<string, { slug: string; sicher: boolean }>,
): CategorySuggestion {
  if (bisher.confidence >= 0.75) return bisher;

  const name = tx.counterparty?.toLowerCase().trim();
  if (!name) return bisher;

  const treffer = kiErgebnis.get(name);
  if (!treffer) return bisher;

  return {
    categorySlug: treffer.slug,
    // Bewusst unter der Schwelle: ein KI-Vorschlag wird angezeigt und
    // vorausgewählt, aber erst nach deiner Bestätigung wirksam.
    confidence: treffer.sicher ? 0.7 : 0.5,
    stage: "ki",
    reason: treffer.sicher
      ? `KI-Vorschlag für "${tx.counterparty}" — bitte kurz bestätigen`
      : `KI ist sich bei "${tx.counterparty}" unsicher`,
  };
}
