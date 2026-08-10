import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * libSQL bringt für den Zugriff auf lokale Dateien native Bindungen mit.
   * Gebündelt würden sie brechen, deshalb bleiben sie extern. Auf Vercel
   * kommt ohnehin nur der HTTP-Pfad zum Einsatz.
   */
  serverExternalPackages: ["@libsql/client", "libsql"],

  // Erzeugt einen schlanken Standalone-Build für das Docker-Image.
  output: process.env.VERCEL ? undefined : "standalone",

  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
