"use client";

import { useActionState } from "react";
import { aenderePasswort } from "@/app/actions";

export function PasswortFormular() {
  const [zustand, aktion, laeuft] = useActionState(
    aenderePasswort,
    null as { fehler?: string; ok?: string } | null,
  );

  return (
    <form action={aktion} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--text-secondary)]">Bisheriges Passwort</span>
        <input
          type="password"
          name="alt"
          required
          autoComplete="current-password"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--text-secondary)]">Neues Passwort</span>
        <input
          type="password"
          name="neu"
          required
          minLength={10}
          autoComplete="new-password"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm"
        />
      </label>

      {zustand?.fehler && (
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          {zustand.fehler}
        </p>
      )}
      {zustand?.ok && (
        <p role="status" className="text-sm" style={{ color: "var(--good)" }}>
          {zustand.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={laeuft}
        className="self-start rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        Ändern
      </button>
    </form>
  );
}
