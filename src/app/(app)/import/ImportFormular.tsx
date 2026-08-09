"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Upload, CircleCheck, TriangleAlert } from "lucide-react";
import { importiereDatei } from "@/app/actions";
import type { ImportErgebnis } from "@/server/import";

export function ImportFormular() {
  const [zustand, aktion, laeuft] = useActionState(
    importiereDatei,
    null as { fehler?: string; berichte?: ImportErgebnis[] } | null,
  );

  return (
    <>
      <form action={aktion} className="flex flex-col gap-4">
        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--border-strong)] px-6 py-10 text-center transition-colors hover:bg-[var(--surface-2)]"
        >
          <Upload size={26} className="text-[var(--text-muted)]" />
          <span className="text-sm font-medium">Dateien wählen oder hierher ziehen</span>
          <span className="text-xs text-[var(--text-muted)]">
            CAMT.053-XML vom Bankkonto und CSV von Swisscard — beide gleichzeitig möglich
          </span>
          <input
            type="file"
            name="datei"
            multiple
            accept=".xml,.csv,text/xml,text/csv"
            className="sr-only"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </label>

        {laeuft && (
          <p className="text-sm text-[var(--text-secondary)]">Wird eingelesen…</p>
        )}
      </form>

      {zustand?.fehler && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{
            color: "var(--danger)",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
          }}
        >
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
          {zustand.fehler}
        </p>
      )}

      {zustand?.berichte?.map((b, i) => (
        <div key={i} className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck size={18} style={{ color: "var(--good)" }} />
            {b.dateiname}
          </p>

          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">Neu</dt>
              <dd className="tabular font-semibold">{b.neu}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">Schon bekannt</dt>
              <dd className="tabular font-semibold">{b.bekannt}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">Offen</dt>
              <dd className="tabular font-semibold">{b.offen}</dd>
            </div>
          </dl>

          {b.saldoprobe && (
            <p
              className="mt-3 flex items-start gap-2 text-xs"
              style={{ color: b.saldoprobe.ok ? "var(--good)" : "var(--danger)" }}
            >
              {b.saldoprobe.ok ? <CircleCheck size={14} className="mt-0.5" /> : <TriangleAlert size={14} className="mt-0.5" />}
              {b.saldoprobe.text}
            </p>
          )}

          {b.warnungen.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
                {b.warnungen.length} Hinweise
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                {b.warnungen.slice(0, 10).map((w, n) => (
                  <li key={n}>• {w}</li>
                ))}
              </ul>
            </details>
          )}

          {b.offen > 0 && (
            <Link
              href="/pruefen"
              className="mt-3 inline-block text-sm font-medium"
              style={{ color: "var(--n-fix)" }}
            >
              {b.offen} Buchungen zuordnen →
            </Link>
          )}
        </div>
      ))}
    </>
  );
}
