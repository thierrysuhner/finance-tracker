import { NextResponse } from "next/server";
import { getDb } from "@/db";

/** Bereitschaftsprüfung für Docker, Fly.io und Reverse Proxy. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.get("SELECT 1 AS ok");
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json(
      { status: "error", detail: e instanceof Error ? e.message : "unbekannt" },
      { status: 503 },
    );
  }
}
