import type { Treatment } from "../types";

/**
 * Regelwerk für öffentlich bekannte Händler und Marken.
 *
 * WAS HIER NICHT HINEINGEHÖRT: personenbezogene Zuordnungen. Der Name des
 * Vermieters, der Eltern oder von Kollegen darf nicht im Git landen. Solche
 * Zuordnungen lernt die App zur Laufzeit und legt sie in der Datenbank ab,
 * die per .gitignore ausgeschlossen ist. Hier stehen ausschliesslich Firmen,
 * die ohnehin jeder kennt.
 *
 * REIHENFOLGE IST BEDEUTSAM: die erste passende Regel gewinnt. Spezifische
 * Muster stehen deshalb vor allgemeinen — "Migros Restaurant" ist auswärts
 * essen, "Migros" ist Lebensmittel, und die Tankstelle "Migrol" ist weder
 * das eine noch das andere.
 *
 * Geprüft wird gegen den normalisierten Schlüssel aus merchantKey():
 * kleingeschrieben, ohne Umlaute und Sonderzeichen.
 * "Coop-5855 SG City K." wird zu "coop 5855 sg city k".
 */

export interface Rule {
  match: RegExp;
  category: string;
  /** Nur anwenden bei Ausgabe ("out") oder nur bei Einnahme ("in"). */
  direction?: "out" | "in";
  treatment?: Treatment;
  /** Standard 0.85 — Regeln sind gut, aber schlechter als selbst bestätigt. */
  confidence?: number;
  why: string;
}

export const RULES: Rule[] = [
  // ── Gastronomie-Ableger von Detailhändlern (vor der Marke selbst!) ───────
  { match: /^migros (mr|restaurant|gourmessa|take|gastro)/, category: "auswaerts",
    why: "Migros-Restaurant bzw. Take-away" },
  { match: /^migros kulturb/, category: "ausgehen", why: "Migros Kulturprozent" },
  { match: /^(mig )?migrolino/, category: "lebensmittel", why: "Migrolino Convenience-Shop" },
  { match: /^migrol/, category: "mobilitaet", why: "Migrol Tankstelle" },
  { match: /^migros/, category: "lebensmittel", why: "Migros" },
  { match: /^coop (pronto|to go)|aperto/, category: "lebensmittel", why: "Coop Pronto / Aperto" },
  { match: /^coop restaurant|^coop gastro/, category: "auswaerts", why: "Coop Restaurant" },
  { match: /^coop/, category: "lebensmittel", why: "Coop" },

  // ── Übriger Detailhandel Lebensmittel ───────────────────────────────────
  { match: /^(denner|aldi|lidl|volg|spar|landi|otto s|alnatura|globus deli)/,
    category: "lebensmittel", why: "Lebensmittelhändler" },
  { match: /^(metzgerei|baeckerei|backerei|beck |konditorei|hofladen)/,
    category: "lebensmittel", why: "Metzgerei / Bäckerei" },
  { match: /^mymuesli/, category: "lebensmittel", why: "Lebensmittel-Versand" },

  // ── Auswärts essen, Kaffee, Take-away ───────────────────────────────────
  { match: /(restaurant|pizzeria|trattoria|osteria|focacceria|brasserie|bistro|kebab|imbiss|lmbiss|take away|takeaway|take-away|kurier)/,
    category: "auswaerts", why: "Restaurant / Take-away" },
  { match: /^(starbucks|coffee|caf |cafe|caff|kaffee|tea room|brezelkonig|brezelkoenig|selecta|ass bar|elvetino)/,
    category: "auswaerts", why: "Café / Kaffee / Automat" },
  { match: /^(mcdonald|burger king|five ?guys|subway|holycow|holy cow|hans im gluck|dieci|vapiano|nordsee|bamboo|edomae|sushi|poke)/,
    category: "auswaerts", why: "Schnellrestaurant" },
  { match: /^(sud caf|ad hoc|ess werk|mit ohne|mit und ohne|vemezza|swiss tasty|santis gastro|gschwend)/,
    category: "auswaerts", why: "Gastronomie" },
  { match: /^(chocolat|pralin|confiserie|laderach|sprungli)/, category: "auswaerts", why: "Confiserie" },

  // ── Mobilität ───────────────────────────────────────────────────────────
  // SBB steht bei Swisscard unter "Reisen". Pendeln ist aber Mobilität und
  // gehört ins Alltagsbudget, nicht ins Ferienbudget.
  { match: /^(sbb|cff|ffs)\b|^sbb/, category: "mobilitaet", why: "SBB" },
  { match: /^(postauto|carpostal|vbz|vbsg|zvv|tnw|bvb|bls|rhb|zsg|libero|ostwind)/,
    category: "mobilitaet", why: "Öffentlicher Verkehr" },
  { match: /(tankstelle|^avia|^eni |^socar|^shell|^bp |^agrola|^tamoil|^ruedi rueegg)/,
    category: "mobilitaet", why: "Tankstelle" },
  { match: /(parking|parkhaus|parkingpay|park \+ rail|p\+r)/, category: "mobilitaet", why: "Parkgebühr" },
  { match: /^(uber|bolt|dott|tier|lime|bird|taxi|mobility|publibike)/,
    category: "mobilitaet", why: "Fahrdienst / Sharing" },
  { match: /^(transport for london|tfl|db bahn|deutsche bahn|oebb|trenitalia|sncf)/,
    category: "mobilitaet", why: "Öffentlicher Verkehr Ausland" },
  { match: /(strassenverkehrsamt|autoprufung|fahrschule|garage |pneuhaus)/,
    category: "mobilitaet", why: "Fahrzeug" },

  // ── Gesundheit ──────────────────────────────────────────────────────────
  { match: /(apotheke|pharmacie|farmacia|drogerie|drogeria)/, category: "gesundheit", why: "Apotheke / Drogerie" },
  { match: /^(dr med|dr\.|zahnarzt|arztpraxis|praxis |spital|klinik|hirslanden|physiotherapie|optiker|fielmann|visilab)/,
    category: "gesundheit", why: "Arzt / Medizin" },

  // ── Haushalt ────────────────────────────────────────────────────────────
  { match: /^(ikea|hornbach|jumbo|bauhaus|obi|coop bau|do it|micasa|pfister|sostrene|depot |butlers)/,
    category: "haushalt", why: "Haushalt / Einrichtung" },
  { match: /(textilpflege|waescherei|wascherei|reinigung|coiffeur|barbier|friseur)/,
    category: "haushalt", why: "Haushaltsdienstleistung" },

  // ── Abos, Software, Telekom ─────────────────────────────────────────────
  { match: /^(apple|itunes|icloud)/, category: "abos", why: "Apple-Abo" },
  { match: /^(spotify|netflix|disney|dazn|youtube|google|microsoft|adobe|dropbox|notion|openai|anthropic|github|steam|nintendo|playstation)/,
    category: "abos", why: "Digitales Abo" },
  { match: /^(swisscom|salt|sunrise|wingo|yallo|lebara|lycamobile|klarmobil|m budget mobile|digital republic|talktalk)/,
    category: "telekom", why: "Mobilfunk / Internet" },
  { match: /^(hosttech|infomaniak|cyon|hostpoint|nine ch|metanet|hetzner|netlify|vercel|cloudflare|namecheap|gandi)/,
    category: "telekom", why: "Hosting / Domain" },
  { match: /^(serafe|billag)/, category: "abos", why: "Radio- und Fernsehabgabe" },

  // ── Versicherungen ──────────────────────────────────────────────────────
  { match: /^(css|helsana|swica|sanitas|concordia|visana|assura|sympany|atupri|kpt|groupe mutuel)/,
    category: "versicherung", why: "Krankenkasse" },
  { match: /^(axa|zurich vers|die mobiliar|mobiliar|allianz|baloise|generali|helvetia|smile|tcs|elvia)/,
    category: "versicherung", why: "Versicherung" },

  // ── Ausbildung ──────────────────────────────────────────────────────────
  { match: /(universit|hochschule|fachhochschule|\bhsg\b|\beth\b|\bepfl\b|\bzhaw\b|\bfhnw\b|studiengebuhr|semestergebuhr|bocconi)/,
    category: "ausbildung", direction: "out", why: "Hochschule" },
  { match: /^(orell fussli|ex libris|thalia|weltbild|fachbuch)/, category: "ausbildung", why: "Bücher" },

  // ── Behörden und Gebühren ───────────────────────────────────────────────
  { match: /^(gebuehren|gebuhren|kontofuhrung|jahresgebuhr|spesen)$/, category: "gebuehren", why: "Bankgebühr" },
  { match: /(bundesamt|kantonspolizei|polizeiverwaltung|betreibungsamt|gemeindeverwaltung|einwohneramt|steueramt|zivilstandsamt|passburo|justiz)/,
    category: "gebuehren", why: "Amtsgebühr" },
  { match: /^(die schweizerische post|post ch|postfinance)/, category: "gebuehren", why: "Post / Porto" },

  // ── Ausgehen und Kultur ─────────────────────────────────────────────────
  { match: /(kino|cinema|pathe|arena cinemas|blue cinema)/, category: "ausgehen", why: "Kino" },
  { match: /(ticketcorner|eventfrog|starticket|see tickets|ticketmaster|eventim)/,
    category: "ausgehen", why: "Veranstaltungsticket" },
  { match: /(\bclub\b|\bbar\b|lounge|nightlife|disco|festival|konzert|theater|museum|oper )/,
    category: "ausgehen", why: "Ausgehen / Kultur" },

  // ── Reisen ──────────────────────────────────────────────────────────────
  { match: /^(ryanair|easyjet|swiss int|lufthansa|edelweiss|eurowings|klm|air france|british airways|wizz|vueling)/,
    category: "reisen", why: "Fluggesellschaft" },
  { match: /^(booking|airbnb|hotel|hostel|jugendherberge|youth hostel|camping|expedia|trivago|hotelplan|kuoni|tui)/,
    category: "reisen", why: "Unterkunft / Reise" },

  // ── Sport, Verein, Hobby ────────────────────────────────────────────────
  { match: /(fitness|gym|migros fitnesspark|kletterhalle|boulder|walkthrough|schwimmbad|hallenbad|bergbahn|skilift|sportbahnen)/,
    category: "freizeit", why: "Sport" },
  { match: /(verein|club fahrwangen|gesellschaft|turnverein|rugby|fussballclub|\bfc |\bsc |pistolenclub|schutzenverein)/,
    category: "freizeit", why: "Verein" },

  // ── Shopping ────────────────────────────────────────────────────────────
  { match: /^(zalando|about you|asos|hm |h m |zara|c a |we fashion|wefashion|calvin klein|adidas|nike|puma|snipes|ochsner|dosenbach|bata|vogele|chicoree|new yorker|uniqlo|mango|bershka|nuvonda)/,
    category: "shopping", why: "Kleidung" },
  { match: /^(digitec|galaxus|brack|microspot|interdiscount|melectronics|fust|mediamarkt|apfelkiste|skysale|conrad|steg)/,
    category: "shopping", why: "Elektronik" },
  { match: /^(manor|globus|jelmoli|loeb|ricardo|tutti|anibis|ebay|amazon|aliexpress|temu|shein|galaxus)/,
    category: "shopping", why: "Warenhaus / Marktplatz" },
  { match: /(vistaprint|gonser|jewelry|schmuck|uhren|bijouterie|parfumerie|marionnaud|douglas)/,
    category: "shopping", why: "Shopping" },
  { match: /(blumen|floristik|florist|geschenk|geschenkkarte|gift card)/, category: "geschenke", why: "Blumen / Geschenk" },

  // ── Neutral: Ausgleich und Umbuchung ────────────────────────────────────
  { match: /^(swisscard|cornercard|viseca|cembra|american express|amex)/,
    category: "kartenausgleich", treatment: "neutral", confidence: 0.95,
    why: "Kreditkarten-Monatsrechnung — die Einzelbuchungen kommen aus dem Kartenexport" },
  { match: /^(swissquote|interactive brokers|degiro|saxo|postfinance fonds|truewealth|selma|vzfinanz|yuh|neon invest)/,
    category: "investment", treatment: "neutral", confidence: 0.95, why: "Anlagekonto" },

  // ── Einnahmen ───────────────────────────────────────────────────────────
  { match: /(sozialversicherungsanstalt|ausgleichskasse|truppenrechnungswesen|\beo\b|stipendi|erwerbsersatz)/,
    category: "erwerbsersatz", direction: "in", why: "Erwerbsersatz / Sozialversicherung" },
  { match: /(lohn|gehalt|salaer|salar|payroll)/, category: "lohn", direction: "in", why: "Lohnzahlung" },
  { match: /^cashback$/, category: "einkommen_sonstig", direction: "in", why: "Kartenprämie" },
  { match: /^(ruckverguetung|ruckerstattung|rueckverguetung|rueckerstattung|refund)/,
    category: "erstattung", direction: "in", treatment: "neutral", why: "Rückerstattung" },

  // ── Umbuchungen zwischen eigenen Konten ─────────────────────────────────
  // Greift, wenn die Gegen-IBAN fehlt und nur der Zweck vorliegt — auf dem
  // neon-Auszug ist das der Normalfall.
  { match: /^(kontouebertrag|kontoubertrag|uebertrag|ubertrag|umbuchung|eigenuebertrag|topup|top up)/,
    category: "eigenuebertrag", treatment: "neutral", confidence: 0.9,
    why: "Umbuchung zwischen eigenen Konten" },
];

/**
 * Zuordnung der Swisscard-Händlerkategorie als schwaches Signal.
 *
 * Der Kartenherausgeber liefert eine eigene Einteilung mit. Sie ist grob
 * richtig, aber nicht immer passend: SBB-Billette landen dort unter "Reisen",
 * obwohl Pendeln zum Alltag gehört. Deshalb greift diese Zuordnung erst,
 * wenn keine Regel und kein Gedächtnis passt — und mit niedriger Konfidenz.
 */
export const ISSUER_CATEGORY_MAP: Record<string, string> = {
  // ── neon (englische Bezeichnungen, daher kollisionsfrei) ───────────────
  "food": "auswaerts",        // deckt bei neon überwiegend Restaurants ab
  "groceries": "lebensmittel",
  "shopping": "shopping",
  "transport": "mobilitaet",
  "travel": "reisen",
  "leisure": "freizeit",
  "household": "haushalt",
  "health": "gesundheit",
  "housing": "miete",
  "education": "ausbildung",
  "finances": "gebuehren",

  // ── Swisscard (deutsche Bezeichnungen) ─────────────────────────────────
  // "transport" und "shopping" stehen bereits oben — bei beiden Anbietern
  // dieselbe Bedeutung, deshalb nur einmal aufgeführt.
  "lebensmittel": "lebensmittel",
  "gastronomie": "auswaerts",
  "restaurants": "auswaerts",
  "reisen": "reisen",
  "auto": "mobilitaet",
  "unterhaltung": "ausgehen",
  "freizeit": "freizeit",
  "gesundheit": "gesundheit",
  "gesundheit und schönheit": "gesundheit",
  "gesundheit und schoenheit": "gesundheit",
  "familie & haushalt": "haushalt",
  "haushalt": "haushalt",
  "dienstleistungen": "sonstiges",
  "bildung": "ausbildung",
  // "cash" (TWINT an Privatpersonen) bewusst nicht abgebildet: dahinter kann
  // alles stecken, von der geteilten Rechnung bis zum geliehenen Geld.
  "versicherung": "versicherung",
  "allgemein": "sonstiges",
};
