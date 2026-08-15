"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, setJsonSetting, setSetting, SETTING_KEYS } from "@/db";
import { merkeZuordnung } from "@/server/context";
import { importiere, protokolliere, ergaenzeMitKi } from "@/server/import";
import { setzeBudget, uebernehmeVorschlaege } from "@/server/budget";
import {
  passwortStimmt, setzePasswort, erstelleSitzung, setzeSitzungsCookie,
  loescheSitzung, istEingerichtet, pruefeEinrichtungsToken,
} from "@/lib/auth";
import { parseAmountToRappen } from "@/core/money";
import { CATEGORY_BY_SLUG } from "@/core/categorize/categories";

/** Alle schreibenden Vorgänge an einem Ort. */

// ── Anmeldung ──────────────────────────────────────────────────────────────

export async function anmelden(_prev: unknown, formular: FormData) {
  const passwort = String(formular.get("passwort") ?? "");
  const weiter = String(formular.get("weiter") ?? "/");

  if (!(await istEingerichtet())) {
    // Erster Start: das eingegebene Passwort wird gesetzt. Im Produktivbetrieb
    // erst nach Vorlage des Einmalkennworts — sonst könnte ein Fremder dem
    // frisch veröffentlichten Dienst zuvorkommen.
    const token = pruefeEinrichtungsToken(String(formular.get("setupToken") ?? ""));
    if (!token.ok) return { fehler: token.fehler };

    if (passwort.length < 10) {
      return { fehler: "Bitte mindestens 10 Zeichen wählen." };
    }
    await setzePasswort(passwort);
  } else if (!(await passwortStimmt(passwort))) {
    return { fehler: "Passwort stimmt nicht." };
  }

  await setzeSitzungsCookie(await erstelleSitzung());
  redirect(weiter.startsWith("/") ? weiter : "/");
}

export async function abmelden() {
  await loescheSitzung();
  redirect("/login");
}

// ── Zuordnung ──────────────────────────────────────────────────────────────

/**
 * Ordnet eine Buchung zu und merkt sich die Entscheidung.
 *
 * Das Merken ist der eigentliche Punkt: dieselbe Zuordnung soll kein zweites
 * Mal nötig sein. Beim Setzen auf "alle künftigen" wird zusätzlich ein
 * Marken-Eintrag angelegt, der auch andere Filialen abdeckt.
 *
 * `vorgabe` kommt von den Schnellauswahl-Knöpfen und hat Vorrang vor dem
 * Formularfeld. Der Umweg ist nötig, weil React bei einer Server Action weder
 * den Namen noch den Wert des angeklickten Submit-Knopfes ins FormData
 * übernimmt — ein Knopf muss seine Kategorie also gebunden mitgeben.
 */
export async function ordneZu(vorgabe: string | null, formular: FormData) {
  const id = Number(formular.get("id"));
  const kategorie = vorgabe ?? String(formular.get("kategorie") ?? "");
  const merken = formular.get("merken") === "on" || formular.get("merken") === "true";
  const auchMarke = formular.get("auchMarke") === "on";
  const notwendigkeit = String(formular.get("notwendigkeit") ?? "");

  if (!id || !CATEGORY_BY_SLUG.has(kategorie)) return;

  const db = await getDb();
  const zeile = await db.get<{ counterparty: string | null; amount: number }>(
    "SELECT counterparty, amount FROM transactions WHERE id = ?",
    [id],
  );
  if (!zeile) return;

  const def = CATEGORY_BY_SLUG.get(kategorie)!;
  const treatment = def.group === "neutral" ? "neutral" : "normal";
  const jetzt = new Date().toISOString();

  await db.run(
    `UPDATE transactions
     SET category_slug = ?, treatment = ?, necessity_override = ?,
         confidence = 1, stage = 'gedaechtnis', reviewed = 1,
         reason = 'Von dir zugeordnet', updated_at = ?
     WHERE id = ?`,
    [
      kategorie,
      treatment,
      notwendigkeit && notwendigkeit !== def.necessity ? notwendigkeit : null,
      jetzt,
      id,
    ],
  );

  if (merken && zeile.counterparty) {
    await merkeZuordnung(zeile.counterparty, kategorie, {
      treatment: treatment === "neutral" ? "neutral" : undefined,
      auchMarke,
    });

    // Gleich alle offenen Buchungen desselben Händlers mitnehmen — sonst
    // müsste dieselbe Entscheidung für jeden Besuch wiederholt werden.
    await db.run(
      `UPDATE transactions
       SET category_slug = ?, treatment = ?, confidence = 0.95,
           stage = 'gedaechtnis', reason = 'Aus deiner Zuordnung übernommen',
           updated_at = ?
       WHERE counterparty = ? AND reviewed = 0 AND id != ?`,
      [kategorie, treatment, jetzt, zeile.counterparty, id],
    );
  }

  revalidatePath("/pruefen");
  revalidatePath("/");
}

/** Verrechnet einen Geldeingang mit der Ausgabe, die er ausgleicht. */
export async function verrechne(formular: FormData) {
  const eingangId = Number(formular.get("eingangId"));
  const ausgabeId = Number(formular.get("ausgabeId"));
  if (!eingangId || !ausgabeId) return;

  const db = await getDb();
  await db.run(
    `UPDATE transactions
     SET offset_of = ?, treatment = 'neutral', category_slug = 'erstattung',
         reviewed = 1, confidence = 1, reason = 'Mit einer Ausgabe verrechnet',
         updated_at = ?
     WHERE id = ?`,
    [ausgabeId, new Date().toISOString(), eingangId],
  );

  revalidatePath("/pruefen");
  revalidatePath("/");
}

export async function hebeVerrechnungAuf(formular: FormData) {
  const id = Number(formular.get("id"));
  if (!id) return;
  const db = await getDb();
  await db.run(
    `UPDATE transactions SET offset_of = NULL, treatment = 'normal',
     reviewed = 0, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
  revalidatePath("/pruefen");
}

/** Markiert eine Buchung als geprüft, ohne die Kategorie zu ändern. */
export async function bestaetige(formular: FormData) {
  const id = Number(formular.get("id"));
  if (!id) return;
  const db = await getDb();
  await db.run(
    `UPDATE transactions SET reviewed = 1, confidence = 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
  revalidatePath("/pruefen");
  revalidatePath("/");
}

// ── Manuelle Erfassung ─────────────────────────────────────────────────────

/**
 * Bargeld und Ausgaben über andere Konten.
 *
 * Ohne diese Möglichkeit hätte die Auswertung eine systematische Lücke:
 * alles, was nicht über Konto oder Karte lief, fehlte einfach.
 */
export async function erfasseManuell(formular: FormData) {
  const betragText = String(formular.get("betrag") ?? "").trim();
  const datum = String(formular.get("datum") ?? "");
  const beschreibung = String(formular.get("beschreibung") ?? "").trim();
  const kategorie = String(formular.get("kategorie") ?? "");
  const konto = String(formular.get("konto") ?? "Bargeld");

  if (!betragText || !datum || !CATEGORY_BY_SLUG.has(kategorie)) {
    return { fehler: "Bitte Betrag, Datum und Kategorie angeben." };
  }

  let rappen: number;
  try {
    rappen = Math.abs(parseAmountToRappen(betragText));
  } catch {
    return { fehler: `Betrag "${betragText}" ist nicht lesbar.` };
  }

  const def = CATEGORY_BY_SLUG.get(kategorie)!;
  const istEinnahme = def.group === "einkommen";
  const jetzt = new Date().toISOString();

  const db = await getDb();
  await db.run(
    `INSERT INTO transactions (
       external_id, source, account_ref, booking_date, amount, currency,
       raw_text, counterparty, category_slug, treatment, confidence, stage,
       reason, reviewed, created_at, updated_at
     ) VALUES (?, 'manual', ?, ?, ?, 'CHF', ?, ?, ?, ?, 1, 'gedaechtnis',
       'Von dir erfasst', 1, ?, ?)`,
    [
      `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      konto,
      datum,
      istEinnahme ? rappen : -rappen,
      beschreibung || konto,
      beschreibung || null,
      kategorie,
      def.group === "neutral" ? "neutral" : "normal",
      jetzt,
      jetzt,
    ],
  );

  revalidatePath("/buchungen");
  revalidatePath("/");
  return { ok: true };
}

export async function loescheBuchung(formular: FormData) {
  const id = Number(formular.get("id"));
  if (!id) return;
  // Nur selbst erfasste Buchungen dürfen weg — importierte kämen beim
  // nächsten Import ohnehin wieder und würden dann als neu gelten.
  const db = await getDb();
  await db.run("DELETE FROM transactions WHERE id = ? AND source = 'manual'", [id]);
  revalidatePath("/buchungen");
  revalidatePath("/");
}

// ── Import ─────────────────────────────────────────────────────────────────

export async function importiereDatei(_prev: unknown, formular: FormData) {
  const dateien = formular.getAll("datei").filter((d): d is File => d instanceof File);
  if (dateien.length === 0) return { fehler: "Keine Datei gewählt." };

  const berichte = [];
  for (const datei of dateien) {
    if (datei.size === 0) continue;
    try {
      const inhalt = await datei.text();
      const e = await importiere(datei.name, inhalt);
      await protokolliere(e);
      berichte.push(e);
    } catch (f) {
      return { fehler: f instanceof Error ? f.message : "Import fehlgeschlagen." };
    }
  }

  // Erst nachdem alles sicher gespeichert ist. Ist kein Schlüssel hinterlegt
  // oder der Dienst nicht erreichbar, bleibt es beim Nachfragen.
  try {
    await ergaenzeMitKi();
  } catch {
    // bewusst still — der Import ist bereits erfolgreich abgeschlossen
  }

  revalidatePath("/");
  revalidatePath("/pruefen");
  return { berichte };
}

// ── Budget ─────────────────────────────────────────────────────────────────

export async function speichereBudget(formular: FormData) {
  const slug = String(formular.get("slug") ?? "");
  const wert = String(formular.get("betrag") ?? "").trim();
  if (!CATEGORY_BY_SLUG.has(slug)) return;

  if (!wert) {
    await setzeBudget(slug, null);
  } else {
    try {
      await setzeBudget(slug, Math.abs(parseAmountToRappen(wert)));
    } catch {
      return;
    }
  }
  revalidatePath("/budget");
  revalidatePath("/");
}

export async function budgetsAusHistorie() {
  await uebernehmeVorschlaege();
  revalidatePath("/budget");
  revalidatePath("/");
}

// ── Einstellungen ──────────────────────────────────────────────────────────

export async function speichereEinstellungen(formular: FormData) {
  const namen = String(formular.get("eigeneNamen") ?? "")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const ibanListe = (feld: string) =>
    String(formular.get(feld) ?? "")
      .split("\n")
      .map((s) => s.replace(/\s/g, "").toUpperCase())
      .filter(Boolean);

  const ibans = ibanListe("eigeneIbans");
  const anlage = ibanListe("anlageIbans");
  const verknuepft = ibanListe("verknuepfteIbans");
  const schwelle = Number(formular.get("schwelle"));

  await setJsonSetting(SETTING_KEYS.ownNames, namen);
  // Verknüpfte Konten gehören zusätzlich zu den eigenen: die Aufladung soll
  // in jedem Fall neutral sein, auch wenn der zugehörige Auszug fehlt.
  await setJsonSetting(SETTING_KEYS.ownIbans, [...new Set([...ibans, ...verknuepft])]);
  await setJsonSetting(SETTING_KEYS.investmentIbans, anlage);
  await setJsonSetting(SETTING_KEYS.linkedIbans, verknuepft);
  if (Number.isFinite(schwelle) && schwelle > 0 && schwelle <= 1) {
    await setSetting(SETTING_KEYS.reviewThreshold, String(schwelle));
  }

  revalidatePath("/einstellungen");
  revalidatePath("/");
}

export async function speichereKi(formular: FormData) {
  const anbieter = String(formular.get("anbieter") ?? "").trim();
  const schluessel = String(formular.get("apiKey") ?? "").trim();

  if (!anbieter) {
    // Anbieter auf "Aus" heisst abschalten — dann läuft alles rein lokal.
    await setSetting(SETTING_KEYS.aiProvider, "");
    await setSetting(SETTING_KEYS.aiApiKey, "");
  } else {
    await setSetting(SETTING_KEYS.aiProvider, anbieter);
    // Leeres Schlüsselfeld bei gewähltem Anbieter heisst "unverändert lassen".
    // Der Schlüssel wird nie ins Formular zurückgegeben, deshalb wäre ein
    // Speichern ohne erneute Eingabe sonst ein versehentliches Löschen.
    if (schluessel) await setSetting(SETTING_KEYS.aiApiKey, schluessel);
  }
  revalidatePath("/einstellungen");
}

export async function aenderePasswort(_prev: unknown, formular: FormData) {
  const alt = String(formular.get("alt") ?? "");
  const neu = String(formular.get("neu") ?? "");
  if (!(await passwortStimmt(alt))) return { fehler: "Das bisherige Passwort stimmt nicht." };
  try {
    await setzePasswort(neu);
  } catch (f) {
    return { fehler: f instanceof Error ? f.message : "Fehlgeschlagen." };
  }
  return { ok: "Passwort geändert." };
}
