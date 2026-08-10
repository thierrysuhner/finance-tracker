"use client";

import { useActionState } from "react";
import { anmelden } from "@/app/actions";

export function AnmeldeFormular({ weiter, neu }: { weiter: string; neu: boolean }) {
  const [zustand, aktion, laeuft] = useActionState(anmelden, null as { fehler?: string } | null);

  return (
    <form action={aktion} className="flex flex-col gap-3">
      <input type="hidden" name="weiter" value={weiter} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--text-secondary)]">Passwort</span>
        <input
          type="password"
          name="passwort"
          required
          minLength={neu ? 10 : undefined}
          autoFocus
          autoComplete={neu ? "new-password" : "current-password"}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2.5"
        />
      </label>

      {neu && (
        <p className="text-xs text-[var(--text-muted)]">
          Mindestens 10 Zeichen. Ein Satz, den nur du kennst, ist sicherer und leichter
          zu merken als ein kurzes Kryptogramm.
        </p>
      )}

      {zustand?.fehler && (
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          {zustand.fehler}
        </p>
      )}

      <button
        type="submit"
        disabled={laeuft}
        className="mt-1 rounded-lg bg-[var(--n-fix)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {laeuft ? "Einen Moment…" : neu ? "Passwort setzen" : "Anmelden"}
      </button>
    </form>
  );
}
