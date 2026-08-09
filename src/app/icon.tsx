import { ImageResponse } from "next/og";

/**
 * App-Icon für Browser-Tab und Home-Bildschirm.
 *
 * Wird zur Bauzeit erzeugt, damit keine Bilddatei gepflegt werden muss.
 * Das Manifest verweist darauf — ohne dieses Symbol zeigt iOS beim
 * "Zum Home-Bildschirm" nur einen Screenshot der Seite.
 */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/*
 * Bewusst ohne Schrift gezeichnet: ImageResponse lädt für Sonderzeichen eine
 * Schriftart aus dem Netz nach. Auf einem privaten Server ohne freien
 * Ausgang schlägt das fehl und das Icon bliebe leer. Drei Balken in den
 * Farben der Notwendigkeitsstufen kommen ohne jede Abhängigkeit aus.
 */
export default function Icon() {
  const balken = [
    { hoehe: "38%", farbe: "#3987e5" },
    { hoehe: "62%", farbe: "#199e70" },
    { hoehe: "88%", farbe: "#d95926" },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 34,
          background: "#121211",
          paddingBottom: 96,
        }}
      >
        {balken.map((b) => (
          <div
            key={b.farbe}
            style={{
              width: 92,
              height: b.hoehe,
              background: b.farbe,
              borderRadius: 18,
            }}
          />
        ))}
      </div>
    ),
    size,
  );
}
