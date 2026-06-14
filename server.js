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
    console.log(`  ✅ Added profile #${i}`);
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

console.log("✅ Credentials loaded successfully!");

const ENDPOINTS = {
  us: { base: "https://us-autocomplete-pro.api.smarty.com/lookup", allowed: new Set(["search","selected","max_results","source","include_only_cities","include_only_states","include_only_zip_codes","exclude_states","prefer_cities","prefer_states","prefer_zip_codes","prefer_ratio","prefer_geolocation"]), required: ["search"] },
  intl: { base: "https://international-autocomplete.api.smarty.com/v2/lookup", allowed: new Set(["search","country","max_results","include_only_locality","include_only_administrative_area","include_only_postal_code","geolocation"]), required: ["country"] }
};

const US_ALIASES = new Set(["US","USA","U.S.","U.S.A.","UNITED STATES","UNITED STATES OF AMERICA"]);
function resolveRegion(country) {
  return US_ALIASES.has(String(country).trim().toUpperCase()) ? "us" : "intl";
}

const ttlMs = Number(CACHE_TTL || 60) * 1000;
const cache = new Map();
function cacheGet(key) { if (ttlMs <= 0) return null; const hit = cache.get(key); if (!hit || Date.now() > hit.expires) { cache.delete(key); return null; } return hit; }
function cacheSet(key, value) { if (ttlMs <= 0) return; cache.set(key, { ...value, expires: Date.now() + ttlMs }); }

const app = express();
app.set("trust proxy", 1);

const allowList = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowList.length ? allowList : true, methods: ["GET"] }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

// ... (rest of the file remains the same - I'll keep it short for now)

app.get("/lookup", (req, res) => {
  const country = (req.query.country || "").trim();
  if (!country) return res.status(400).json({ error: "Missing country" });
  // placeholder for now
  return res.json({ status: "ok", region: resolveRegion(country) });
});

app.get("/health", (_req, res) => res.json({ ok: true, us: Boolean(usProfiles), intl: Boolean(intlProfiles) }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`API proxy on :${process.env.PORT || 3000}`);
});
