import { NextResponse } from "next/server";
import { getSqlite } from "@/db";

/** Bereitschaftsprüfung für Docker und Reverse Proxy. */
export async function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json(
      { status: "error", detail: e instanceof Error ? e.message : "unbekannt" },
      { status: 503 },
    );
  }
}
