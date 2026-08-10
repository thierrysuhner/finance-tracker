# Finanzen

Ausgaben-Tracker und Budget für ein einzelnes Lohnkonto plus Kreditkarte.
Rückblick auf die vergangenen Monate, Vorausschau auf die kommenden.
Läuft privat gehostet mit Passwortschutz, auf Desktop und Handy.

Investments und langfristiges Sparen bleiben bewusst draussen: Überträge auf
eigene Konten werden erkannt und neutral gestellt, damit sie die
Ausgabenstatistik nicht verzerren.

---

## Der Monatsablauf

1. **Kontoauszug ziehen.** Im E-Banking der Hypothekarbank Lenzburg den
   Auszug im Format **ISO 20022 (CAMT.053)** als XML herunterladen.
2. **Kartenexport ziehen.** Im Swisscard-Portal den CSV-Export der
   Transaktionen. Ohne diese Datei erscheint die Monatsrechnung nur als eine
   Sammelbuchung, und rund ein Viertel der Ausgaben bleibt ohne Kategorie.
3. **Auszug des verknüpften Kontos ziehen**, falls eines genutzt wird (neon
   für Fremdwährungsausgaben). Ohne diesen Auszug verschwinden die dortigen
   Ausgaben spurlos, weil die Aufladung als Umbuchung neutral gestellt wird —
   die App meldet eine solche Lücke unter *Einstellungen*.
4. **Alle Dateien unter `/import` hochladen.** Das Format wird am Inhalt
   erkannt, nicht am Dateinamen. Bereits bekannte Buchungen werden erkannt und
   übersprungen — die Exporte sind kumulativ, das ist eingeplant.
5. **Unter `/pruefen` die offenen Fälle zuordnen.** Erfahrungsgemäss ein gutes
   Dutzend pro Monat, sortiert nach Betrag. Jede Entscheidung wird gelernt und
   nicht wieder gefragt.
6. **Bargeld nachtragen** unter `/buchungen`, falls etwas ausserhalb von Konto
   und Karte gelaufen ist.

---

## Was dabei im Hintergrund passiert

### Die Zahlen stimmen oder der Import meldet sich

Nach jedem Bankimport läuft eine **Saldoprobe**: die Summe aller Buchungen muss
exakt der Differenz zwischen Eröffnungs- und Schlusssaldo entsprechen. Weicht
sie ab, steht das im Importbericht. Beträge werden durchgängig als ganzzahlige
Rappen geführt, damit diese Probe auf den Rappen aufgeht statt an
Fliesskomma-Ungenauigkeiten zu scheitern.

### Doppelzählungen sind ausgeschlossen

Drei Fallen sind eingebaut abgefangen:

| Falle | Behandlung |
|---|---|
| Kreditkarten-Monatsrechnung | Erscheint sowohl als Sammelbelastung im Bankauszug als auch als LSV-Zeile im Kartenexport. Beide werden als Ausgleich markiert; gezählt werden nur die einzelnen Kartenbuchungen. Über zwei Jahre echter Daten heben sich beide Seiten auf den Rappen genau auf. |
| Übertrag aufs Anlagekonto | Erkannt über die hinterlegte IBAN und zusätzlich über den Zahlungszweck "Investments". Wird getrennt von übrigen Umbuchungen ausgewiesen. |
| Aufladung eines verknüpften Kontos | Neutral gestellt; gezählt werden die Ausgaben aus dessen eigenem Auszug. Fehlt der Auszug, meldet die Deckungsprüfung die Lücke. |
| Rückzahlung eines Kollegen | Wird der ursprünglichen Ausgabe zugeordnet, statt als Einnahme zu zählen. |

### Kategorisierung in Stufen

Die erste Stufe, die greift, gewinnt:

1. **Struktur** — eigenes Konto, Kartenausgleich, ISO-Lohncode. Praktisch sicher.
2. **Gedächtnis** — genau dieser Händler wurde schon einmal zugeordnet.
3. **Marke** — eine andere Filiale derselben Marke ist bekannt.
4. **Regelwerk** — bekannte Firma aus der eingebauten Tabelle.
5. **Kartenhinweis** — die grobe Einteilung von Swisscard.
6. **KI** — optional, nur für den Rest, nur wenn ein Schlüssel hinterlegt ist.

Alles unterhalb der Konfidenzschwelle landet in der Nachfrage-Liste statt still
falsch einsortiert zu werden.

Zwei Feinheiten, die aus echten Daten entstanden sind:

- **Betragsprüfung.** Dieselbe Person kann in zwei Rollen auftauchen: der
  Vermieter bekommt monatlich 488 Franken Miete und gelegentlich 20 Franken
  per TWINT fürs Mittagessen. Weicht der Betrag stark vom gelernten Muster ab,
  wird nachgefragt.
- **Rückerstattungen.** Geld, das von einem Händler zurückkommt, bei dem man
  sonst bezahlt, ist keine Einnahme, sondern eine Retoure — und wird zur
  Verrechnung vorgeschlagen.

### Nötig gegen freiwillig

Jede Kategorie trägt eine Notwendigkeitsstufe: **gebunden** (Miete,
Versicherung), **nötig** (Lebensmittel, Mobilität), **freiwillig**
(Restaurant, Shopping). Das ist die eigentliche Steuerungsachse — nicht wofür
das Geld wegging, sondern ob es auch anders hätte sein können. Einzelne
Buchungen lassen sich abweichend einstufen.

### Budget und Prognose

Budgetvorschläge entstehen aus dem **Median** der bisherigen Monate, nicht aus
dem Durchschnitt: eine einzelne Semestergebühr oder Reise würde den
Durchschnitt unbrauchbar verschieben. Die Hochrechnung aufs Monatsende
behandelt Fixkosten gesondert — die Miete kommt einmal, nicht anteilig jeden
Tag.

Wiederkehrende Belastungen werden aus dem Zahlungsmuster erkannt und mit ihrem
echten Rhythmus eingeplant. Eine halbjährliche Rechnung erscheint deshalb im
richtigen Monat statt als Zwölftel in jedem.

---

## Datenschutz

Dies ist kein Nebenaspekt, sondern eine Bauentscheidung:

- **Kontoauszüge, Datenbank und Backups sind in `.gitignore` gesperrt.** Das
  Verzeichnis `data/` verlässt das Gerät nie.
- **Das Regelwerk im Code enthält ausschliesslich öffentlich bekannte Firmen.**
  Personenbezogene Zuordnungen — Vermieter, Familie, Kollegen — lernt die App
  zur Laufzeit in die Datenbank. Namen von Personen stehen an keiner Stelle im
  Quellcode.
- **Der optionale KI-Fallback bekommt nur Händlernamen.** Keine Beträge, keine
  Daten, und Privatpersonen werden gar nicht erst angefragt. Ohne Schlüssel
  passiert nichts — die Zuordnung funktioniert vollständig ohne KI.

---

## Betrieb

### Lokal

```bash
npm install
echo "SESSION_SECRET=$(openssl rand -base64 48)" > .env.local
npm run dev
```

Ohne weitere Angabe landet die Datenbank in `data/finance.db`. Ein anderer Ort
lässt sich über `DATABASE_PATH` setzen; ist `TURSO_DATABASE_URL` gesetzt, wird
stattdessen die entfernte Datenbank verwendet.

Beim ersten Aufruf wird das Passwort gesetzt. Es gibt keine
Zurücksetzen-Funktion — geht es verloren, hilft nur das Bearbeiten der
Datenbankdatei.

### Wo das laufen kann — und wo nicht

Die Anwendung braucht zwei Dinge: eine Node-Laufzeit und **einen Ort, an dem
die Datenbank bestehen bleibt**. Das schliesst zwei naheliegende Optionen aus:

| Plattform | Geeignet? | Grund |
|---|---|---|
| **Vercel + Turso** | ja, dauerhaft gratis | Empfohlen. `git push` genügt, keine Wartung. Beide Gratis-Stufen sind für einen Nutzer weit überdimensioniert. |
| **Eigener Server / VPS** | ja, gratis wenn vorhanden | `docker compose up -d`. Volle Datenhoheit. |
| **Oracle Cloud Always Free** | ja, dauerhaft gratis | ARM-VM mit Docker. Selbst verwaltet, Einrichtung dauert eine Stunde. |
| **Fly.io, Railway** | ja, aber kostenpflichtig | Der Gratis-Tarif von Fly.io wurde im Oktober 2024 abgeschafft; mit `fly.toml` sind ein bis drei Franken im Monat zu erwarten. |
| **GitHub Pages** | nein | Liefert nur statische Dateien aus. Login, Server Actions und Datenbank haben dort keine Laufzeit. |

### Vercel mit Turso (empfohlen)

Vercels Dateisystem ist flüchtig — eine SQLite-Datei wäre nach jedem Kaltstart
leer. Deshalb liegt die Datenbank bei **Turso**, einem SQLite-Abkömmling.
Dieselbe Anwendung spricht beide an, es ändert sich nur die Verbindung.

```bash
# 1. Datenbank anlegen
turso db create finanzen
turso db show finanzen --url          # -> libsql://…
turso db tokens create finanzen       # -> Zugriffstoken

# 2. Bei Vercel hinterlegen (Settings → Environment Variables)
#    TURSO_DATABASE_URL   libsql://…
#    TURSO_AUTH_TOKEN     …
#    SESSION_SECRET       openssl rand -base64 48
#    SETUP_TOKEN          openssl rand -base64 24   (nur einmal gebraucht)

# 3. Repository verbinden und deployen
vercel --prod
```

**SESSION_SECRET ist Pflicht.** Fehlt es, schlägt jede Anmeldung fehl.

**SETUP_TOKEN schützt die Ersteinrichtung.** Solange kein Passwort gesetzt ist,
könnte sonst jeder Aufrufer eines festlegen — und Vercel-Hostnamen tauchen
binnen Minuten in den öffentlichen Zertifikatsprotokollen auf. Beim ersten
Aufruf verlangt die Anmeldemaske deshalb zusätzlich dieses Kennwort. Danach
kann die Variable wieder gelöscht werden.

**Bestehende Daten übernehmen.** Die Ersteinrichtung geht lokal deutlich
schneller — Dateien importieren, Zuordnungen treffen, alles ohne Netz. Der
fertige Stand wandert danach in einem Schritt hinüber:

```bash
TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… \
  npx tsx scripts/nach-turso.ts data/finance.db
```

Das Werkzeug leert die Zieldatenbank, überträgt in Blöcken und prüft am Ende,
ob auf beiden Seiten gleich viele Buchungen liegen.

**Was das kostet:** nichts. Vercels Hobby-Stufe ist für private Projekte
gratis, Turso erlaubt 5 GB und 500 Millionen gelesene Zeilen im Monat — eine
Datenbank mit ein paar tausend Buchungen bewegt sich in einer anderen
Grössenordnung. **Was es kostet, ist die Datenhoheit:** deine Kontodaten
liegen dann bei zwei US-Anbietern statt auf einer Maschine, die dir gehört.

### Fly.io

```bash
fly launch --no-deploy --copy-config
fly volumes create finanzen_daten --size 1 --region fra
fly secrets set SESSION_SECRET="$(openssl rand -base64 48)"
fly deploy
```

Danach genügt bei jeder Änderung `fly deploy`. Die Maschine fährt bei
Inaktivität herunter und bei Zugriff in wenigen Sekunden wieder hoch.

### Eigener Server

```bash
echo "SESSION_SECRET=$(openssl rand -base64 48)" > .env
docker compose up -d
```

Der Dienst lauscht bewusst nur auf `127.0.0.1:3000`. Davor gehört ein Reverse
Proxy mit HTTPS (Caddy, nginx, Traefik) — ohne Verschlüsselung wandert das
Passwort im Klartext durchs Netz.

### Backup

Das Volume sichern — darin liegt eine einzige SQLite-Datei. Alles andere lässt
sich jederzeit neu bauen.

```bash
docker compose exec finanzen sh -c 'cat /data/finance.db' > backup-$(date +%F).db
# oder bei Fly.io:  fly ssh console -C 'cat /data/finance.db' > backup.db
```

### Auf dem Handy

Die Seite im Browser öffnen und "Zum Home-Bildschirm" wählen — die App läuft
dann als eigenständiges Fenster ohne Browserleiste.

### Prüfen

```bash
npm test              # Testsuite
npm run typecheck     # Typen
npx tsx scripts/inspect.ts    # zeigt, was die Parser aus data/eingang lesen
npx tsx scripts/evaluate.ts   # misst die Trefferquote der Kategorisierung
```

Die Tests in `tests/echtdaten.test.ts` laufen gegen die echten Dateien in
`data/eingang/`, sofern welche da sind, und werden sonst übersprungen. Nach
jedem Monatsimport einmal `npm test` — schlägt die Saldoprobe fehl, ist beim
Import etwas verloren gegangen.

---

## Aufbau

```
src/
  core/              Fachlogik, ohne Framework — deshalb gut testbar
    parsers/         CAMT.053 und Swisscard-CSV, Freitext-Extraktion
    categorize/      Kategorien, Regelwerk, Stufenlogik, optionale KI
    offset/          Verrechnung von Splits, Retouren und Kautionen
    money.ts         Rappen als Ganzzahlen, Median statt Durchschnitt
  db/                Schema und Zugriff über libSQL (lokale Datei oder Turso)
  server/            Import, Auswertungen, Budget — alles serverseitig
  app/               Oberfläche (Next.js App Router)
tests/               Testsuite
scripts/             Werkzeuge für Kommandozeile und Diagnose
data/                Deine Daten. Nicht im Git.
```
