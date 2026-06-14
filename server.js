import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const { PORT = 3000, ALLOWED_ORIGINS = "", CACHE_TTL = "60" } = process.env;

function loadProfiles(prefix) {
  const profiles = [];
  let i = 0;
  while (true) {
    const key = process.env[`${prefix}_KEY${i || ""}`];
    const referer = process.env[`${prefix}_REFERER${i || ""}`];
    if (!key) break;
    if (!referer) {
      console.error(`${prefix}_KEY${i || ""} is set but ${prefix}_REFERER${i || ""} is missing`);
      process.exit(1);
    }
    profiles.push({ key, referer, skip: 0, fails: 0 });
    i++;
  }
  return profiles.length ? profiles : null;
}

const usProfiles = loadProfiles("API_US");
const intlProfiles = loadProfiles("API_INTL");
if (!usProfiles && !intlProfiles) {
  console.error("No credentials configured. Set API_US_KEY + API_US_REFERER (or numbered: API_US_KEY1 + API_US_REFERER1, API_US_KEY2...) and/or the API_INTL equivalents.");
  process.exit(1);
}

const ENDPOINTS = {
  us: { base: "https://us-autocomplete-pro.api.smarty.com/lookup", allowed: new Set(["search","selected","max_results","source","include_only_cities","include_only_states","include_only_zip_codes","exclude_states","prefer_cities","prefer_states","prefer_zip_codes","prefer_ratio","prefer_geolocation"]), required: ["search"] },
  intl: { base: "https://international-autocomplete.api.smarty.com/v2/lookup", allowed: new Set(["search","country","max_results","include_only_locality","include_only_administrative_area","include_only_postal_code","geolocation"]), required: ["country"] }
};

const US_ALIASES = new Set(["US","USA","U.S.","U.S.A.","UNITED STATES","UNITED STATES OF AMERICA"]);
function resolveRegion(country) {
  return US_ALIASES.has(String(country).trim().toUpperCase()) ? "us" : "intl";
}

// WooCommerce sends ISO 3166-1 alpha-2 codes; Smarty International v2 requires
// UPPERCASE alpha-3. Convert before calling upstream (pass through if already 3).
const ISO2_TO_ISO3 = {
  AF:"AFG",AX:"ALA",AL:"ALB",DZ:"DZA",AS:"ASM",AD:"AND",AO:"AGO",AI:"AIA",AQ:"ATA",AG:"ATG",
  AR:"ARG",AM:"ARM",AW:"ABW",AU:"AUS",AT:"AUT",AZ:"AZE",BS:"BHS",BH:"BHR",BD:"BGD",BB:"BRB",
  BY:"BLR",BE:"BEL",BZ:"BLZ",BJ:"BEN",BM:"BMU",BT:"BTN",BO:"BOL",BQ:"BES",BA:"BIH",BW:"BWA",
  BV:"BVT",BR:"BRA",IO:"IOT",BN:"BRN",BG:"BGR",BF:"BFA",BI:"BDI",CV:"CPV",KH:"KHM",CM:"CMR",
  CA:"CAN",KY:"CYM",CF:"CAF",TD:"TCD",CL:"CHL",CN:"CHN",CX:"CXR",CC:"CCK",CO:"COL",KM:"COM",
  CG:"COG",CD:"COD",CK:"COK",CR:"CRI",CI:"CIV",HR:"HRV",CU:"CUB",CW:"CUW",CY:"CYP",CZ:"CZE",
  DK:"DNK",DJ:"DJI",DM:"DMA",DO:"DOM",EC:"ECU",EG:"EGY",SV:"SLV",GQ:"GNQ",ER:"ERI",EE:"EST",
  SZ:"SWZ",ET:"ETH",FK:"FLK",FO:"FRO",FJ:"FJI",FI:"FIN",FR:"FRA",GF:"GUF",PF:"PYF",TF:"ATF",
  GA:"GAB",GM:"GMB",GE:"GEO",DE:"DEU",GH:"GHA",GI:"GIB",GR:"GRC",GL:"GRL",GD:"GRD",GP:"GLP",
  GU:"GUM",GT:"GTM",GG:"GGY",GN:"GIN",GW:"GNB",GY:"GUY",HT:"HTI",HM:"HMD",VA:"VAT",HN:"HND",
  HK:"HKG",HU:"HUN",IS:"ISL",IN:"IND",ID:"IDN",IR:"IRN",IQ:"IRQ",IE:"IRL",IM:"IMN",IL:"ISR",
  IT:"ITA",JM:"JAM",JP:"JPN",JE:"JEY",JO:"JOR",KZ:"KAZ",KE:"KEN",KI:"KIR",KP:"PRK",KR:"KOR",
  KW:"KWT",KG:"KGZ",LA:"LAO",LV:"LVA",LB:"LBN",LS:"LSO",LR:"LBR",LY:"LBY",LI:"LIE",LT:"LTU",
  LU:"LUX",MO:"MAC",MG:"MDG",MW:"MWI",MY:"MYS",MV:"MDV",ML:"MLI",MT:"MLT",MH:"MHL",MQ:"MTQ",
  MR:"MRT",MU:"MUS",YT:"MYT",MX:"MEX",FM:"FSM",MD:"MDA",MC:"MCO",MN:"MNG",ME:"MNE",MS:"MSR",
  MA:"MAR",MZ:"MOZ",MM:"MMR",NA:"NAM",NR:"NRU",NP:"NPL",NL:"NLD",NC:"NCL",NZ:"NZL",NI:"NIC",
  NE:"NER",NG:"NGA",NU:"NIU",NF:"NFK",MK:"MKD",MP:"MNP",NO:"NOR",OM:"OMN",PK:"PAK",PW:"PLW",
  PS:"PSE",PA:"PAN",PG:"PNG",PY:"PRY",PE:"PER",PH:"PHL",PN:"PCN",PL:"POL",PT:"PRT",PR:"PRI",
  QA:"QAT",RE:"REU",RO:"ROU",RU:"RUS",RW:"RWA",BL:"BLM",SH:"SHN",KN:"KNA",LC:"LCA",MF:"MAF",
  PM:"SPM",VC:"VCT",WS:"WSM",SM:"SMR",ST:"STP",SA:"SAU",SN:"SEN",RS:"SRB",SC:"SYC",SL:"SLE",
  SG:"SGP",SX:"SXM",SK:"SVK",SI:"SVN",SB:"SLB",SO:"SOM",ZA:"ZAF",GS:"SGS",SS:"SSD",ES:"ESP",
  LK:"LKA",SD:"SDN",SR:"SUR",SJ:"SJM",SE:"SWE",CH:"CHE",SY:"SYR",TW:"TWN",TJ:"TJK",TZ:"TZA",
  TH:"THA",TL:"TLS",TG:"TGO",TK:"TKL",TO:"TON",TT:"TTO",TN:"TUN",TR:"TUR",TM:"TKM",TC:"TCA",
  TV:"TUV",UG:"UGA",UA:"UKR",AE:"ARE",GB:"GBR",US:"USA",UM:"UMI",UY:"URY",UZ:"UZB",VU:"VUT",
  VE:"VEN",VN:"VNM",VG:"VGB",VI:"VIR",WF:"WLF",EH:"ESH",YE:"YEM",ZM:"ZMB",ZW:"ZWE"
};
function toISO3(country) {
  const c = String(country).trim().toUpperCase();
  if (c.length === 3) return c;
  return ISO2_TO_ISO3[c] || c;
}

const ttlMs = Number(CACHE_TTL) * 1000;
const cache = new Map();
function cacheGet(key) { if (ttlMs <= 0) return null; const hit = cache.get(key); if (!hit || Date.now() > hit.expires) { cache.delete(key); return null; } return hit; }
function cacheSet(key, value) { if (ttlMs <= 0) return; cache.set(key, { ...value, expires: Date.now() + ttlMs }); }

const app = express();
app.set("trust proxy", 1);
const allowList = ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowList.length ? allowList : true, methods: ["GET"] }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

const sticky = new Map();
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  if (a === b) return 0;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff;
  }
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  for (let i = 0; i <= longer.length; i++) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) return 1;
  }
  return 99;
}

let usIndex = 0;
function getNextUsProfile() {
  if (!usProfiles) return null;
  for (let attempts = 0; attempts < usProfiles.length; attempts++) {
    const p = usProfiles[usIndex];
    usIndex = (usIndex + 1) % usProfiles.length;
    if (p.skip <= 0) return p;
    p.skip--;
  }
  return usProfiles[0];
}
let intlIndex = 0;
function getNextIntlProfile() {
  if (!intlProfiles) return null;
  for (let attempts = 0; attempts < intlProfiles.length; attempts++) {
    const p = intlProfiles[intlIndex];
    intlIndex = (intlIndex + 1) % intlProfiles.length;
    if (p.skip <= 0) return p;
    p.skip--;
  }
  return intlProfiles[0];
}

// Only these upstream statuses mean "this key is the problem, try another one".
// Everything else in the 4xx range is a bad *request*, not a bad key.
function shouldRotate(status) {
  return status === 401 || status === 402 || status === 408 || status === 429 || status >= 500;
}

function buildUpstream(region, addressId, query, profile) {
  const { base, allowed } = ENDPOINTS[region];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (!allowed.has(k) || v === undefined || v === "") continue;
    // Smarty International requires uppercase ISO-3 country codes (WC sends ISO-2).
    params.set(k, (region === "intl" && k === "country") ? toISO3(v) : v);
  }
  // Cache key is derived from the (sorted) request params only -- NOT the API
  // key -- so a result fetched with one key is reused regardless of which key
  // the next request happens to rotate to.
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const cacheKey = `${region}:${addressId || ""}:${new URLSearchParams(sorted).toString()}`;
  params.set("key", profile.key);
  const path = addressId ? `${base}/${encodeURIComponent(addressId)}` : base;
  return { url: `${path}?${params.toString()}`, cacheKey };
}

async function handleLookup(region, req, res, addressId) {
  // Validate BEFORE selecting a profile, so an invalid request doesn't churn
  // the round-robin index / backoff counters.
  const { required } = ENDPOINTS[region];
  for (const param of required) {
    if (!req.query[param]) return res.status(400).json({ error: `Missing ${param}` });
  }
  if (!addressId && !req.query.search) return res.status(400).json({ error: "Missing search" });

  const getNextProfile = region === "us" ? getNextUsProfile : getNextIntlProfile;
  const profilesList = region === "us" ? usProfiles : intlProfiles;
  if (!profilesList) return res.status(503).json({ error: `No credentials for "${region}"` });

  const clientKey = `${region}:${req.ip || "unknown"}`;
  const search = (req.query.search || "").trim();
  const prev = sticky.get(clientKey);
  let profile = (prev && search && levenshtein(search, prev.search) <= 1)
    ? prev.profile
    : getNextProfile();
  if (!profile) return res.status(503).json({ error: `No credentials for "${region}"` });

  let attempts = 0;
  const maxAttempts = profilesList.length * 2;
  while (attempts < maxAttempts) {
    const { url, cacheKey } = buildUpstream(region, addressId, req.query, profile);
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set("x-proxy-cache", "HIT");
      sticky.set(clientKey, { search, profile });
      return res.status(cached.status).type("application/json").send(cached.body);
    }
    const headers = { Accept: "application/json", Referer: profile.referer };
    try {
      const upstream = await fetch(url, { method: "GET", headers });
      const body = await upstream.text();
      const apiStatus = upstream.headers.get("status");

      if (upstream.ok) {
        profile.fails = 0;
        profile.skip = 0;
        cacheSet(cacheKey, { status: upstream.status, body });
        res.set("x-proxy-cache", "MISS");
        if (apiStatus) res.set("x-api-status", apiStatus);
        sticky.set(clientKey, { search, profile });
        return res.status(upstream.status).type("application/json").send(body);
      }

      if (!shouldRotate(upstream.status)) {
        // e.g. 400 / 422: the request is bad, not the key. Pass the upstream
        // response straight back instead of burning every key and reporting a
        // misleading 502. The key authenticated fine, so keep it healthy.
        profile.fails = 0;
        profile.skip = 0;
        res.set("x-proxy-cache", "MISS");
        if (apiStatus) res.set("x-api-status", apiStatus);
        sticky.set(clientKey, { search, profile });
        return res.status(upstream.status).type("application/json").send(body);
      }

      // Auth / payment / rate-limit / 5xx: penalise this key and try the next.
      profile.fails++;
      profile.skip = Math.pow(2, profile.fails - 1);
      console.error(`API ${upstream.status} with key ${profile.key.substring(0, 8)}... (fails: ${profile.fails})`);
    } catch (err) {
      profile.fails++;
      profile.skip = Math.pow(2, profile.fails - 1);
      console.error(`Upstream failed (${region}):`, err);
    }
    attempts++;
    profile = getNextProfile();
    if (!profile) break;
  }
  return res.status(502).json({ error: "All API keys failed" });
}

app.get("/lookup", (req, res) => {
  const country = (req.query.country || "").trim();
  if (!country) return res.status(400).json({ error: "Missing country" });
  return handleLookup(resolveRegion(country), req, res, null);
});
// International drill-down: expand a candidate's address_id (a path segment) into
// its subunits or a detailed result. US autocomplete does not use this route.
app.get("/lookup/:addressId", (req, res) => {
  const country = (req.query.country || "").trim();
  if (!country) return res.status(400).json({ error: "Missing country" });
  return handleLookup(resolveRegion(country), req, res, req.params.addressId);
});
app.get("/health", (_req, res) => res.json({ ok: true, us: Boolean(usProfiles), intl: Boolean(intlProfiles) }));
app.listen(PORT, () => {
  console.log(`API proxy on :${PORT}`);
  console.log(`  US:  ${usProfiles ? "ready" : "off"}`);
  console.log(`  Intl:${intlProfiles ? "ready" : "off"}`);
});
