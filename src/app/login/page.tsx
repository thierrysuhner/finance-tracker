import { istEingerichtet } from "@/lib/auth";
import { AnmeldeFormular } from "./Formular";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ weiter?: string }>;
}) {
  const { weiter } = await searchParams;
  const eingerichtet = istEingerichtet();

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="karte w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">
          {eingerichtet ? "Anmelden" : "Passwort festlegen"}
        </h1>
        <p className="mt-1 mb-5 text-sm text-[var(--text-secondary)]">
          {eingerichtet
            ? "Deine Finanzübersicht ist passwortgeschützt."
            : "Erster Start. Wähle ein Passwort — es gibt keinen Weg, es zurückzusetzen, ausser die Datenbankdatei zu bearbeiten."}
        </p>
        <AnmeldeFormular weiter={weiter ?? "/"} neu={!eingerichtet} />
      </div>
    </div>
  );
}
