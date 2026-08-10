import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Zugangsschutz.
 *
 * Läuft vor jeder Anfrage. Die Prüfung erfolgt hier und nicht erst in den
 * Seiten, damit keine Route versehentlich ungeschützt bleibt — es genügt,
 * einmal das Hinzufügen der Prüfung zu vergessen.
 */

const OEFFENTLICH = ["/login", "/einrichten"];

export async function middleware(req: NextRequest) {
  const pfad = req.nextUrl.pathname;

  if (
    OEFFENTLICH.some((p) => pfad.startsWith(p)) ||
    pfad.startsWith("/_next") ||
    pfad.startsWith("/icon") ||
    pfad === "/manifest.webmanifest" ||
    pfad === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("ft_session")?.value;
  const secret = process.env.SESSION_SECRET;

  if (token && secret && secret.length >= 32) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      return NextResponse.next();
    } catch {
      // abgelaufen oder manipuliert — weiter zur Anmeldung
    }
  }

  const ziel = new URL("/login", req.url);
  // Nach der Anmeldung dorthin zurückkehren, wo der Nutzer hinwollte.
  if (pfad !== "/") ziel.searchParams.set("weiter", pfad);
  return NextResponse.redirect(ziel);
}

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
