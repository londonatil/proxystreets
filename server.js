import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

console.log("=== ENV DEBUG ===");
console.log("API_US_KEY present:", !!process.env.API_US_KEY);
console.log("API_US_REFERER present:", !!process.env.API_US_REFERER);
console.log("API_INTL_KEY present:", !!process.env.API_INTL_KEY);

function loadProfiles(prefix) {
  console.log("Loading profiles for", prefix);
  const profiles = [];
  let i = 0;
  while (true) {
    const key = process.env[prefix + "_KEY" + (i || "")];
    const referer = process.env[prefix + "_REFERER" + (i || "")];
    console.log("  " + prefix + "_KEY" + (i || "") + ":", key ? "FOUND" : "MISSING");
    console.log("  " + prefix + "_REFERER" + (i || "") + ":", referer ? "FOUND" : "MISSING");
    if (!key) break;
    if (!referer) {
      console.error("Missing referer for key");
      process.exit(1);
    }
    profiles.push({ key, referer, skip: 0, fails: 0 });
    i++;
  }
  console.log("Loaded", profiles.length, "profiles for", prefix);
  return profiles.length ? profiles : null;
}

const usProfiles = loadProfiles("API_US");
const intlProfiles = loadProfiles("API_INTL");

if (!usProfiles && !intlProfiles) {
  console.error("No credentials configured.");
  process.exit(1);
}

console.log("✅ CREDENTIALS LOADED SUCCESSFULLY!");

const app = express();
app.set("trust proxy", 1);

const allowList = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowList.length ? allowList : true, methods: ["GET"] }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.get("/lookup", (req, res) => {
  const country = (req.query.country || "").trim();
  if (!country) return res.status(400).json({ error: "Missing country" });
  res.json({ status: "ok", message: "Proxy is working" });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ API proxy running on port", process.env.PORT || 3000);
});
