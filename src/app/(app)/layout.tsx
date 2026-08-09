import { Nav } from "@/components/Nav";
import { offeneBuchungen } from "@/server/queries";

/**
 * Rahmen für alle geschützten Seiten.
 *
 * Die Anzahl offener Zuordnungen wird hier einmal geladen und als Zähler in
 * der Navigation angezeigt — damit sichtbar ist, dass noch etwas zu tun ist,
 * ohne dass man die Seite aufrufen muss.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let offene = 0;
  try {
    offene = offeneBuchungen(500).length;
  } catch {
    // Datenbank noch leer oder nicht erreichbar — die App bleibt bedienbar.
  }

  return (
    <div className="min-h-dvh">
      <Nav offeneAnzahl={offene} />
      <main className="px-4 pt-5 pb-24 sm:ml-56 sm:px-8 sm:pt-8 sm:pb-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
