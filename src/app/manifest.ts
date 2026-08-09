import type { MetadataRoute } from "next";

/** PWA-Manifest — erlaubt "Zum Home-Bildschirm" auf iOS und Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finanzen",
    short_name: "Finanzen",
    description: "Ausgaben verstehen und budgetieren",
    start_url: "/",
    display: "standalone",
    background_color: "#121211",
    theme_color: "#121211",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
