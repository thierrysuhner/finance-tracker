import type { CategoryDef } from "../types.js";

/**
 * Die Kategorien-Taxonomie.
 *
 * Zentrale Idee: jede Kategorie trägt eine Notwendigkeitsstufe. Das ist die
 * eigentliche Steuerungsachse — nicht "wofür ging das Geld weg", sondern
 * "hätte es auch anders sein können".
 *
 *   fix        Vertraglich gebunden, kurzfristig nicht veränderbar (Miete).
 *   noetig     Unvermeidbar, aber in der Höhe beeinflussbar (Lebensmittel).
 *   freiwillig Frei entscheidbar (Restaurant, Shopping).
 *   neutral    Keine echte Ausgabe (Umbuchung, Ausgleich).
 *
 * Die Stufe ist ein Standard, kein Dogma: eine einzelne Buchung kann im UI
 * abweichend eingestuft werden. Winterjacke ist Shopping, aber wenn es die
 * einzige ist, ist sie nötig.
 */
export const CATEGORIES: CategoryDef[] = [
  // ── Fixkosten ────────────────────────────────────────────────────────────
  { slug: "miete",        label: "Miete & Nebenkosten",      necessity: "fix", icon: "🏠", group: "fix" },
  { slug: "ausbildung",   label: "Studium & Ausbildung",     necessity: "fix", icon: "🎓", group: "fix" },
  { slug: "versicherung", label: "Versicherungen",           necessity: "fix", icon: "🛡️", group: "fix" },
  { slug: "telekom",      label: "Handy, Internet & Hosting",necessity: "fix", icon: "📶", group: "fix" },
  { slug: "abos",         label: "Abos & Software",          necessity: "fix", icon: "🔁", group: "fix" },
  { slug: "gebuehren",    label: "Bank- & Amtsgebühren",     necessity: "fix", icon: "🏦", group: "fix" },

  // ── Variabel, aber nötig ─────────────────────────────────────────────────
  { slug: "lebensmittel", label: "Lebensmittel",             necessity: "noetig", icon: "🛒", group: "variabel" },
  { slug: "mobilitaet",   label: "Mobilität",                necessity: "noetig", icon: "🚆", group: "variabel" },
  { slug: "gesundheit",   label: "Gesundheit",               necessity: "noetig", icon: "💊", group: "variabel" },
  { slug: "haushalt",     label: "Haushalt & Drogerie",      necessity: "noetig", icon: "🧺", group: "variabel" },

  // ── Freiwillig ───────────────────────────────────────────────────────────
  { slug: "auswaerts",    label: "Auswärts essen & Kaffee",  necessity: "freiwillig", icon: "🍽️", group: "freiwillig" },
  { slug: "ausgehen",     label: "Ausgehen & Kultur",        necessity: "freiwillig", icon: "🎭", group: "freiwillig" },
  { slug: "shopping",     label: "Shopping",                 necessity: "freiwillig", icon: "👕", group: "freiwillig" },
  { slug: "reisen",       label: "Reisen & Ferien",          necessity: "freiwillig", icon: "✈️", group: "freiwillig" },
  { slug: "freizeit",     label: "Sport, Verein & Hobby",    necessity: "freiwillig", icon: "⚽", group: "freiwillig" },
  { slug: "geschenke",    label: "Geschenke & Spenden",      necessity: "freiwillig", icon: "🎁", group: "freiwillig" },
  { slug: "sonstiges",    label: "Sonstiges",                necessity: "freiwillig", icon: "❓", group: "freiwillig" },

  // ── Neutral: keine echte Ausgabe ─────────────────────────────────────────
  { slug: "eigenuebertrag",  label: "Eigenübertrag",          necessity: "neutral", icon: "🔄", group: "neutral" },
  { slug: "investment",      label: "Investment & Sparen",    necessity: "neutral", icon: "📈", group: "neutral" },
  { slug: "kartenausgleich", label: "Kreditkarten-Ausgleich", necessity: "neutral", icon: "💳", group: "neutral" },
  { slug: "kaution",         label: "Kaution & Depot",        necessity: "neutral", icon: "🔐", group: "neutral" },
  { slug: "erstattung",      label: "Erstattung & Retoure",   necessity: "neutral", icon: "↩️", group: "neutral" },

  // ── Einkommen ────────────────────────────────────────────────────────────
  { slug: "lohn",              label: "Lohn & Nebenjob",           necessity: "neutral", icon: "💼", group: "einkommen" },
  { slug: "erwerbsersatz",     label: "Erwerbsersatz & Stipendium",necessity: "neutral", icon: "🎖️", group: "einkommen" },
  { slug: "familie",           label: "Unterstützung Familie",     necessity: "neutral", icon: "👨‍👩‍👦", group: "einkommen" },
  { slug: "einkommen_sonstig", label: "Übriges Einkommen",         necessity: "neutral", icon: "➕", group: "einkommen" },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "Nicht zugeordnet";
  return CATEGORY_BY_SLUG.get(slug)?.label ?? slug;
}

/** Kategorien, die als echte Ausgabe in Budget und Auswertung zählen. */
export const AUSGABEN_KATEGORIEN = CATEGORIES.filter(
  (c) => c.group === "fix" || c.group === "variabel" || c.group === "freiwillig",
);

export const EINKOMMEN_KATEGORIEN = CATEGORIES.filter((c) => c.group === "einkommen");

/** Reihenfolge fürs Dashboard: gebunden zuerst, frei zuletzt. */
export const GRUPPEN_REIHENFOLGE = ["fix", "variabel", "freiwillig", "einkommen", "neutral"] as const;
