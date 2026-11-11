/**
 * Rooktest: opent elke pagina (ook de detailpagina's via de eerste link in de lijst), en meldt HTTP-status,
 * console-fouten, mislukte verzoeken en zichtbare foutteksten.
 *   node docs/qa/harness/rooktest.cjs http://localhost:3100 [map-voor-screenshots]
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- los Node-script, Playwright staat globaal
const { chromium } = require("playwright");

const LIJSTEN = ["/", "/inzetten", "/medewerkers", "/contracten", "/klanten", "/inbox", "/acties", "/facturatie", "/tevredenheid", "/instellingen"];
const DETAIL = { "/inzetten": /^\/inzetten\/[0-9a-f-]{36}$/, "/medewerkers": /^\/medewerkers\/[0-9a-f-]{36}$/, "/contracten": /^\/contracten\/[0-9a-f-]{36}$/, "/klanten": /^\/klanten\/[0-9a-f-]{36}$/, "/inbox": /^\/inbox\/[0-9a-f-]{36}$/, "/acties": /^\/acties\/[0-9a-f-]{36}\/mail$/, "/facturatie": /^\/facturatie\/[0-9a-f-]{36}$/, "/tevredenheid": /^\/tevredenheid\/[0-9a-f-]{36}$/ };

(async () => {
  const base = process.argv[2] || "http://localhost:3100";
  const shots = process.argv[3];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let fouten = [];
  page.on("console", (m) => m.type() === "error" && fouten.push(`console: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => fouten.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => !r.url().includes("_next/static") && fouten.push(`request mislukt: ${r.url().slice(0, 120)}`));
  page.on("response", (r) => r.status() >= 400 && fouten.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`));
  const resultaten = [];
  const bezoek = async (pad) => {
    fouten = [];
    const res = await page.goto(base + pad, { waitUntil: "networkidle", timeout: 90000 });
    const tekst = await page.locator("body").innerText();
    const kop = await page.locator("h1").first().innerText().catch(() => "(geen h1)");
    if (/Application error|Unhandled Runtime Error|This page could not be found|Internal Server Error/i.test(tekst)) fouten.push("foutpagina zichtbaar");
    if (shots) await page.screenshot({ path: `${shots}/${pad === "/" ? "dashboard" : pad.slice(1).replace(/\//g, "_").replace(/[0-9a-f-]{36}/, "detail")}.png`, fullPage: true });
    resultaten.push({ pad, status: res ? res.status() : 0, kop, fouten: [...new Set(fouten)] });
    return page;
  };
  for (const lijst of LIJSTEN) {
    await bezoek(lijst);
    const re = DETAIL[lijst];
    if (!re) continue;
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const detail = hrefs.find((h) => h && re.test(h));
    if (detail) await bezoek(detail);
    else resultaten.push({ pad: `${lijst}/[id]`, status: 0, kop: "(geen link naar detail gevonden)", fouten: ["detailpagina niet bereikbaar vanuit de lijst"] });
  }
  await browser.close();
  let slecht = 0;
  for (const r of resultaten) {
    const ok = r.status === 200 && r.fouten.length === 0;
    if (!ok) slecht++;
    console.log(`${ok ? "OK  " : "FOUT"} ${r.status} ${r.pad}  —  ${r.kop}${r.fouten.length ? "\n       " + r.fouten.join("\n       ") : ""}`);
  }
  console.log(`\n${resultaten.length - slecht} van ${resultaten.length} pagina's zonder fouten`);
  process.exit(slecht ? 1 : 0);
})();
