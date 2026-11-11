/**
 * Microsoft Forms: formulierdefinitie (vragen + ID's) ophalen, vraagrollen herkennen en vooraf ingevulde links maken.
 *
 * Forms heeft geen officiële API. De publieke "runtime"-definitie (wat een invuller te zien krijgt) is wel op te halen
 * zonder login, zolang het formulier voor iedereen openstaat: daarmee kennen we de vraag-ID's die nodig zijn voor
 * vooraf ingevulde links en om de antwoorden uit de Power Automate-mail aan vragen te koppelen. Reacties zelf zijn
 * niet publiek; die komen via de flow (mail naar de gedeelde mailbox) of een Excel-export binnen.
 */

export type VraagType = "TextField" | "Rating" | "NPS" | "Choice" | string;

export interface FormVraag {
  id: string;
  titel: string;
  type: VraagType;
}

export interface FormDefinitie {
  id: string;
  url: string;
  titel: string;
  /** Instelling "Vooraf ingevulde antwoorden" in Forms; staat die uit, dan negeert Forms de ingevulde waarden. */
  prefillAan: boolean;
  vragen: FormVraag[];
}

/** De vaste vragen die we herkennen om een reactie aan een inzet/klant/persoon te koppelen. */
export type VraagRol = "naam" | "functie" | "organisatie" | "medewerker" | "project";

const ROL_PATRONEN: Array<[VraagRol, RegExp]> = [
  ["naam", /^uw naam\b/i],
  ["functie", /^uw functie\b/i],
  ["organisatie", /^uw (organisatie|bedrijf)\b/i],
  ["medewerker", /medewerker die u beoordeelt|naam (van de )?medewerker/i],
  ["project", /^project(naam)?\b/i],
];

export function rolVanVraag(titel: string): VraagRol | null {
  const t = titel.trim();
  for (const [rol, re] of ROL_PATRONEN) if (re.test(t)) return rol;
  return null;
}

/** Vraag-ID per rol (eerste treffer). */
export function rolVragen(def: FormDefinitie): Partial<Record<VraagRol, FormVraag>> {
  const out: Partial<Record<VraagRol, FormVraag>> = {};
  for (const v of def.vragen) {
    const rol = rolVanVraag(v.titel);
    if (rol && !out[rol]) out[rol] = v;
  }
  return out;
}

/** Haalt de formulier-ID uit een Forms-link (`...ResponsePage.aspx?id=...`) of accepteert een kale ID. */
export function formIdUitUrl(urlOfId: string): string | null {
  const s = urlOfId.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.searchParams.get("id");
  } catch {
    return /^[A-Za-z0-9_-]{40,}\.{0,2}$/.test(s) ? s : null;
  }
}

function guidUitBytes(b: Uint8Array): string {
  // .NET Guid.ToByteArray(): de eerste drie velden zijn little-endian.
  const hex = (i: number) => b[i].toString(16).padStart(2, "0");
  const d1 = [3, 2, 1, 0].map(hex).join("");
  const d2 = [5, 4].map(hex).join("");
  const d3 = [7, 6].map(hex).join("");
  const d4 = [8, 9].map(hex).join("");
  const d5 = [10, 11, 12, 13, 14, 15].map(hex).join("");
  return `${d1}-${d2}-${d3}-${d4}-${d5}`;
}

/** Tenant- en eigenaar-ID zitten base64url-gecodeerd in de formulier-ID (32 bytes: tenant, eigenaar). */
export function formIdentiteit(formId: string): { tenantId: string; eigenaarId: string } | null {
  try {
    const b64 = formId.replace(/-/g, "+").replace(/_/g, "/").replace(/\.+$/, "");
    const bytes = Uint8Array.from(Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64"));
    if (bytes.length < 32) return null;
    return { tenantId: guidUitBytes(bytes.subarray(0, 16)), eigenaarId: guidUitBytes(bytes.subarray(16, 32)) };
  } catch {
    return null;
  }
}

interface RuntimeForm {
  id?: string;
  title?: string;
  settings?: string;
  questions?: Array<{ id: string; title: string; type: string; order?: number }>;
}

/** Zet de runtime-JSON van Forms om naar onze definitie. */
export function parseRuntimeForm(json: RuntimeForm, url: string): FormDefinitie {
  if (!json.id || !Array.isArray(json.questions)) throw new Error("Onverwacht antwoord van Microsoft Forms");
  let prefillAan = false;
  try {
    prefillAan = Boolean(json.settings && JSON.parse(json.settings).AllowPrefill);
  } catch {
    prefillAan = false;
  }
  return {
    id: json.id,
    url,
    titel: (json.title ?? "").trim(),
    prefillAan,
    vragen: [...json.questions]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((q) => ({ id: q.id, titel: q.title.replace(/\s+/g, " ").trim(), type: q.type.replace(/^Question\./, "") })),
  };
}

/** Haalt de actuele definitie op bij Microsoft Forms. Gooit bij een fout (geen netwerk, formulier gesloten, ...). */
export async function haalFormDefinitie(url: string, fetchImpl: typeof fetch = fetch): Promise<FormDefinitie> {
  const formId = formIdUitUrl(url);
  if (!formId) throw new Error("Geen geldige Forms-link (verwacht ...ResponsePage.aspx?id=...)");
  const ident = formIdentiteit(formId);
  if (!ident) throw new Error("Formulier-ID niet te ontleden");
  const api =
    `https://forms.office.com/formapi/api/${ident.tenantId}/users/${ident.eigenaarId}/light/runtimeForms('${encodeURIComponent(formId)}')` +
    `?$expand=questions($expand=choices)`;
  const res = await fetchImpl(api, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Microsoft Forms antwoordde ${res.status}`);
  return parseRuntimeForm((await res.json()) as RuntimeForm, url);
}

/**
 * Vooraf ingevulde link: `&<vraag-ID>=<waarde>` per vraag (zo maakt Forms ze zelf; tekstvragen zonder aanhalingstekens).
 * Werkt alleen als in Forms "Vooraf ingevulde antwoorden" aan staat; anders opent de link gewoon een leeg formulier.
 */
export function prefillUrl(def: FormDefinitie, waarden: Partial<Record<VraagRol, string | null | undefined>>): string {
  const rollen = rolVragen(def);
  const params: string[] = [];
  for (const rol of ["organisatie", "medewerker", "project"] as const) {
    const v = waarden[rol]?.trim();
    const vraag = rollen[rol];
    if (v && vraag) params.push(`${vraag.id}=${encodeURIComponent(v)}`);
  }
  const basis = def.url.includes("?") ? def.url : `${def.url}?id=${def.id}`;
  return params.length ? `${basis}&${params.join("&")}` : basis;
}

/** Korte vraagtekst voor tabellen ("Begrijpt de medewerker de opdracht ..." → max. ~60 tekens). */
export function korteVraag(titel: string, max = 60): string {
  const t = titel.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}
