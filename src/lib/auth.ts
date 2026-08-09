import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSetting, setSetting, SETTING_KEYS } from "@/db";

/**
 * Anmeldung für einen einzelnen Nutzer.
 *
 * Bewusst ohne fremde Bibliothek für das Passwort: scrypt steckt in Node
 * selbst und ist für diesen Zweck genau richtig. Eine Abhängigkeit weniger,
 * die gepflegt werden muss — bei einer Anwendung, die jahrelang auf dem
 * eigenen Server läuft, zählt das.
 */

const COOKIE = "ft_session";
const SESSION_TAGE = 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). " +
        "Erzeugen mit: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(s);
}

// ── Passwort ───────────────────────────────────────────────────────────────

export function hashPasswort(passwort: string): string {
  const salt = crypto.randomBytes(16);
  // N=2^16 ist bewusst hoch: die Anmeldung passiert selten, ein Angreifer
  // müsste jeden Rateversuch einzeln bezahlen.
  const key = crypto.scryptSync(passwort.normalize("NFKC"), salt, 64, {
    N: 65536, r: 8, p: 1, maxmem: 128 * 65536 * 8 * 2,
  });
  return `scrypt$65536$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function pruefePasswort(passwort: string, gespeichert: string): boolean {
  const teile = gespeichert.split("$");
  if (teile.length !== 6 || teile[0] !== "scrypt") return false;

  const [, N, r, p, saltB64, keyB64] = teile;
  const salt = Buffer.from(saltB64, "base64");
  const erwartet = Buffer.from(keyB64, "base64");

  const key = crypto.scryptSync(passwort.normalize("NFKC"), salt, erwartet.length, {
    N: Number(N), r: Number(r), p: Number(p),
    maxmem: 128 * Number(N) * Number(r) * 2,
  });

  // Zeitkonstanter Vergleich — ein normaler Vergleich verriete über die
  // Laufzeit, wie viele Zeichen stimmen.
  return crypto.timingSafeEqual(key, erwartet);
}

export function istEingerichtet(): boolean {
  return getSetting(SETTING_KEYS.passwordHash) !== null;
}

export function setzePasswort(passwort: string): void {
  if (passwort.length < 10) {
    throw new Error("Das Passwort muss mindestens 10 Zeichen haben.");
  }
  setSetting(SETTING_KEYS.passwordHash, hashPasswort(passwort));
}

export function passwortStimmt(passwort: string): boolean {
  const gespeichert = getSetting(SETTING_KEYS.passwordHash);
  if (!gespeichert) return false;
  try {
    return pruefePasswort(passwort, gespeichert);
  } catch {
    return false;
  }
}

// ── Sitzung ────────────────────────────────────────────────────────────────

export async function erstelleSitzung(): Promise<string> {
  return await new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TAGE}d`)
    .sign(secret());
}

export async function pruefeSitzung(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

export async function setzeSitzungsCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,               // für JavaScript unsichtbar
    sameSite: "lax",              // schützt vor Anfragen von fremden Seiten
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TAGE * 24 * 60 * 60,
  });
}

export async function loescheSitzung(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function istAngemeldet(): Promise<boolean> {
  const jar = await cookies();
  return pruefeSitzung(jar.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
