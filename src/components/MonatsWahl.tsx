"use client";

import { useRouter, usePathname } from "next/navigation";
import { monatName } from "@/components/ui";

/** Monatsauswahl. Als echtes <select>, damit Mobile die native Auswahl zeigt. */
export function MonatsWahl({ monate, aktiv }: { monate: string[]; aktiv: string }) {
  const router = useRouter();
  const pfad = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Monat auswählen</span>
      <select
        value={aktiv}
        onChange={(e) => router.push(`${pfad}?monat=${e.target.value}`)}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm"
      >
        {monate.map((m) => (
          <option key={m} value={m}>
            {monatName(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
