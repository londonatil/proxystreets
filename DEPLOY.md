# Deploy the Smarty address proxy to Render

## Why
`https://proxystreets.onrender.com` is currently running a placeholder app — every
path returns `{"status":"ok","message":"Proxy is working"}`. The checkout plugin and
CORS are already verified working; the only missing piece is the **real proxy code**
on that Render service. Deploy `server.js` and the autocomplete starts working.

## Files
- `server.js` — the proxy. Reads all config from **environment variables** via
  `process.env`. There is no `.env` file and no `dotenv` — nothing secret lives in
  the code or repo.
- `package.json` — deps + `npm start` → `node server.js` (Node 18+ for built-in fetch).
- `render.yaml` — optional Render Blueprint. Declares the env vars; the Smarty key is
  marked `sync: false` so Render prompts you to enter it securely and never stores it
  in the repo.
- `.gitignore` — keeps `node_modules` and any stray `.env` out of version control.

## Environment variables — set these in Render (not in the repo)
Render → your service → **Environment** → Add Environment Variable:

| Key | Value | Secret? |
|-----|-------|---------|
| `API_US_KEY` | your Smarty embedded (website) key | yes |
| `API_US_REFERER` | a host your Smarty key authorizes, e.g. `https://rubnrestore.com` | — |
| `ALLOWED_ORIGINS` | `https://rubnrestore.com,https://www.rubnrestore.com` | — |
| `API_INTL_KEY` | your International Smarty key | yes |
| `API_INTL_REFERER` | a host your intl key authorizes, e.g. `https://rubnrestore.com` | — |
| `CACHE_TTL` | `60` (optional) | — |

Optional: `API_US_KEY1`/`API_US_REFERER1`, … for key rotation; `API_INTL_KEY`/
`API_INTL_REFERER` for international Smarty. `PORT` is set by Render automatically.

**Dedicated verification keys (optional):** `API_US_VERIFY_KEY` +
`API_US_VERIFY_REFERER` and `API_INTL_VERIFY_KEY` + `API_INTL_VERIFY_REFERER`
give `/verify` its own key pools (numbered rotation works here too:
`API_US_VERIFY_KEY1`, …). If unset, `/verify` shares the autocomplete keys.
`/health` reports `us_verify_dedicated` / `intl_verify_dedicated` so you can
confirm which mode is live.

These are read once at startup. Because they live only in Render's encrypted
environment store, there is no secrets file to leak.

## Deploy
**Option A — Blueprint:** commit `server.js`, `package.json`, `render.yaml`. In Render,
**New + → Blueprint**, pick the repo; Render reads `render.yaml` and prompts you to
enter the `sync: false` values (your Smarty key).

**Option B — Existing service:** push `server.js` + `package.json`. Settings → Build
Command `npm install`, Start Command `npm start`. Add the env vars above. **Manual
Deploy → Deploy latest commit.**

## Verify after deploy
- `https://proxystreets.onrender.com/health` → `{"ok":true,"us":true,...}`
  (still seeing `"Proxy is working"`? the new code isn't live yet)
- `https://proxystreets.onrender.com/lookup?country=US&search=1600%20Amphitheatre%20Pkwy`
  → JSON with a `suggestions` array
- `https://proxystreets.onrender.com/verify?country=US&street=1600%20Amphitheatre%20Pkwy&city=Mountain%20View&state=CA`
  → JSON array of verified candidates (empty `[]` = address not verifiable)
- International verify: `/verify?country=DE&freeform=...` or
  `/verify?country=DE&address1=...&locality=...&postal_code=...`

Once `/lookup` returns suggestions, the checkout autocomplete works with no further
changes.

## Notes
- **Verification licenses:** whichever keys `/verify` uses (dedicated
  `API_*_VERIFY_*` pools, or the autocomplete keys as fallback) need a US Core /
  Rooftop license (US) or International Address Verification license (intl), or
  Smarty returns 402 on `/verify`.
- **Smarty referer:** embedded/website keys are locked to allowed referrer hosts, so
  `API_US_REFERER` must be a host your key authorizes or Smarty returns 401.
- **Free-tier cold start:** the service sleeps after ~15 min idle, so the first
  customer to type waits ~30–60s. Ask me to set up a keep-warm ping, or use a paid
  always-on instance.
