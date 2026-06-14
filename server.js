import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

console.log("=== FULL ENV DEBUG ===");
console.log("API_US_KEY:", process.env.API_US_KEY ? "PRESENT" : "MISSING");
console.log("API_US_REFERER:", process.env.API_US_REFERER ? "PRESENT" : "MISSING");
console.log("API_INTL_KEY:", process.env.API_INTL_KEY ? "PRESENT" : "MISSING");

function loadProfiles(prefix) {
  console.log(`Loading profiles for ${prefix}...`);
  const profiles = [];
  let i = 0;
  while (true) {
    const keyName = `\( {prefix}_KEY \){i || ""}`;
    const refName = `\( {prefix}_REFERER \){i || ""}`;
    const key = process.env[keyName];
    const referer = process.env[refName];
    
    console.log(`  Checking ${keyName}: ${key ? "FOUND" : "MISSING"}`);
    console.log(`  Checking ${refName}: ${referer ? "FOUND" : "MISSING"}`);
    
    if (!key) break;
    if (!referer) {
      console.error(`${keyName} is set but ${refName} is missing`);
      process.exit(1);
    }
    profiles.push({ key, referer, skip: 0, fails: 0 });
    console.log(`  ✅ Added profile #${i} for ${prefix}`);
    i++;
  }
  console.log(`Loaded ${profiles.length} profiles for ${prefix}`);
  return profiles.length ? profiles : null;
}

const usProfiles = loadProfiles("API_US");
const intlProfiles = loadProfiles("API_INTL");

if (!usProfiles && !intlProfiles) {
  console.error("No credentials configured.");
  process.exit(1);
}

console.log("✅ Credentials loaded successfully! US:", Boolean(usProfiles), "Intl:", Boolean(intlProfiles));

const ENDPOINTS = {
  us: { base: "https://us-autocomplete-pro.api.smarty.com/lookup", allowed: new Set(["search","selected","max_results","source","include_only_cities","include_only_states","include_only_zip_codes","exclude_states","prefer_cities","prefer_states","prefer_zip_codes","prefer_ratio","prefer_geolocation"]), required: ["search"] },
  intl: { base: "https://international-autocomplete.api.smarty.com/v2/lookup", allowed: new Set(["search","country","max_results","include_only_locality","include_only_administrative_area","include_only_postal_code","geolocation"]), required: ["country"] }
};

const US_ALIASES = new Set(["US","USA","U.S.","U.S.A.","UNITED STATES","UNITED STATES OF AMERICA"]);
function resolveRegion(country) {
  return US_ALIASES.has(String(country).trim().toUpperCase()) ? "us" : "intl";
}

const ttlMs = Number(process.env.CACHE_TTL || 60) * 1000;
const cache = new Map();
function cacheGet(key) { if (ttlMs <= 0) return null; const hit = cache.get(key); if (!hit || Date.now() > hit.expires) { cache.delete(key); return null; } return hit; }
function cacheSet(key, value) { if (ttlMs <= 0) return; cache.set(key, { ...value, expires: Date.now() + ttlMs }); }

const app = express();
app.set("trust proxy", 1);

const allowList = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
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

function buildUpstreamUrl(region, addressId, query, profile) {
  const { base, allowed } = ENDPOINTS[region];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (allowed.has(k) && v !== undefined && v !== "") params.set(k, v);
  }
  params.set("key", profile.key);
  const path = addressId ? `\( {base}/ \){encodeURIComponent(addressId)}` : base;
  return `\( {path}? \){params.toString()}`;
}

async function handleLookup(region, req, res, addressId) {
  const getNextProfile = region === "us" ? getNextUsProfile : getNextIntlProfile;
  const profilesList = region === "us" ? usProfiles : intlProfiles;

  const clientKey = `\( {region}: \){req.ip || 'unknown'}`;
  const search = (req.query.search || '').trim();
  const prev = sticky.get(clientKey);
  let profile;

  if (prev && search && levenshtein(search, prev.search) <= 1) {
    profile = prev.profile;
  } else {
    profile = getNextProfile();
  }

  if (!profile) return res.status(503).json({ error: `No credentials for "${region}"` });

  const { required } = ENDPOINTS[region];
  for (const param of required) {
    if (!req.query[param]) return res.status(400).json({ error: `Missing ${param}` });
  }
  if (!addressId && !req.query.search) return res.status(400).json({ error: "Missing search" });

  let attempts = 0;
  const maxAttempts = profilesList.length * 2;

  while (attempts < maxAttempts) {
    const upstreamUrl = buildUpstreamUrl(region, addressId, req.query, profile);
    const cacheKey = `\( {region}: \){upstreamUrl}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set("x-proxy-cache", "HIT");
      sticky.set(clientKey, { search, profile });
      return res.status(cached.status).type("application/json").send(cached.body);
    }

    const headers = { Accept: "application/json", Referer: profile.referer };

    try {
      const upstream = await fetch(upstreamUrl, { method: "GET", headers });
      const body = await upstream.text();

      if (upstream.ok) {
        profile.fails = 0;
        profile.skip = 0;
        cacheSet(cacheKey, { status: upstream.status, body });
        res.set("x-proxy-cache", "MISS");
        const apiStatus = upstream.headers.get("status");
        if (apiStatus) res.set("x-api-status", apiStatus);
        sticky.set(clientKey, { search, profile });
        return res.status(upstream.status).type("application/json").send(body);
      } else {
        profile.fails++;
        profile.skip = Math.pow(2, profile.fails - 1);
      }
    } catch (err) {
      profile.fails++;
      profile.skip = Math.pow(2, profile.fails - 1);
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

app.get("/health", (_req, res) => res.json({ ok: true, us: Boolean(usProfiles), intl: Boolean(intlProfiles) }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`API proxy on :${process.env.PORT || 3000}`);
});
