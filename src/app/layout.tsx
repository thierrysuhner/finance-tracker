import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finanzen",
  description: "Ausgaben verstehen und budgetieren",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Finanzen" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
  width: "device-width",
  initialScale: 1,
  // Kein maximumScale — Zoom zu sperren sperrt Menschen aus, die ihn brauchen.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
