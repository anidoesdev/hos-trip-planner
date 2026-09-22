# Deploying: Render (API) + Vercel (web)

The whole deploy takes about 15 minutes, and both services are free. The order matters:
**API first** (so you have its URL), **then the web app**, **then point the API's CORS setting at
the web app's URL**.

Placeholders used below. Replace them with your own values:

| Placeholder | Example |
|---|---|
| `<gh-user>` | `Anika7j` |
| `<api-url>` | `https://hos-trip-planner-api.onrender.com` |
| `<web-url>` | `https://hos-trip-planner.vercel.app` |

---

## 0. Push the code to GitHub

From the repo root (`D:\assement`):

```bash
git add .
git status                      # check: no backend/.env, no node_modules, no .env.local
git commit -m "HOS trip planner: Django API + React frontend"
gh repo create hos-trip-planner --public --source . --remote origin --push
```

(The folder is already a git repo, and `gh` is already logged in as your account.)

---

## 1. API on Render (free web service)

### Option A: Blueprint (recommended; uses `render.yaml`)

1. Go to <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Connect GitHub and pick **hos-trip-planner**. Render reads `render.yaml` and shows a service
   named **hos-trip-planner-api**.
3. It asks for the variables marked `sync: false`:
   - `ORS_API_KEY`: your OpenRouteService key (the same one as in `backend/.env`).
   - `NOMINATIM_USER_AGENT`: `hos-trip-planner/1.0 (contact: <your-email>)`.
     Nominatim's usage policy asks for a real contact.
   - `CORS_ALLOWED_ORIGINS`: enter `https://hos-trip-planner.vercel.app` now. You will confirm
     the exact URL in step 3.
4. Click **Apply**. The first build takes about 3–5 minutes.
5. Check it: `curl <api-url>/api/health` should return `{"status":"ok"}`.

### Option B: manual web service (same settings)

**New +** → **Web Service** → pick the repo, then:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 90` |
| Instance Type | Free |
| Health Check Path | `/api/health` |

Environment variables:

```
PYTHON_VERSION=3.12.4
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<run: python -c "import secrets;print(secrets.token_urlsafe(50))">
DJANGO_ALLOWED_HOSTS=.onrender.com
CORS_ALLOWED_ORIGINS=https://hos-trip-planner.vercel.app
CORS_ALLOWED_ORIGIN_REGEXES=^https://hos-trip-planner(-[a-z0-9-]+)?\.vercel\.app$
HOME_TERMINAL_TZ=America/Chicago
ORS_API_KEY=<your key>
NOMINATIM_USER_AGENT=hos-trip-planner/1.0 (contact: <your-email>)
GEOCODE_COUNTRY_CODES=us,ca
```

> The free tier sleeps after 15 minutes idle, and the first request after that takes about
> 30–60 s. The web app handles this: it pings `/api/health` as soon as the page opens, shows
> "Waking up the planning server…", and retries automatically. Optionally, you can keep the API
> warm with a free uptime monitor (e.g. UptimeRobot) that hits `<api-url>/api/health` every
> 10 minutes.

---

## 2. Web app on Vercel

### Option A: CLI

```bash
npm i -g vercel
cd frontend
vercel login
vercel link                      # "Link to existing project?" → No → name: hos-trip-planner
vercel env add VITE_API_URL production      # paste: <api-url>   (no trailing slash)
vercel env add VITE_API_URL preview         # paste: <api-url>
vercel --prod
```

### Option B: dashboard

1. <https://vercel.com/new> → import **hos-trip-planner** from GitHub.
2. **Project Name:** `hos-trip-planner`. If you choose another name, update the regex in
   `CORS_ALLOWED_ORIGIN_REGEXES` on Render to match.
3. **Root Directory:** `frontend`. The framework preset (Vite), build command (`npm run build`)
   and output directory (`dist`) are detected automatically; `frontend/vercel.json` pins them
   too.
4. **Environment Variables:** `VITE_API_URL` = `<api-url>`.
5. **Deploy.**

> `VITE_API_URL` is compiled into the JavaScript at build time. If you change it later, redeploy
> (Deployments → ⋯ → Redeploy).

---

## 3. Connect the two

1. Copy the production URL Vercel shows (e.g. `https://hos-trip-planner.vercel.app`).
2. On Render, open the service → **Environment** → set `CORS_ALLOWED_ORIGINS` to that exact URL
   (no trailing slash) → **Save Changes**. Render redeploys automatically.
3. Check the CORS header:

   ```bash
   curl -s -D - -o /dev/null -H "Origin: <web-url>" <api-url>/api/health | grep -i access-control
   # → access-control-allow-origin: <web-url>
   ```

4. Open `<web-url>`. The header dot should turn green ("Planner online"). Click **Cross-country**.

## 4. Run the QA script against the live site (optional)

```bash
cd frontend
node scripts/qa.mjs <web-url>     # all presets, 3 viewports, PDF export, error states
node scripts/a11y.mjs <web-url>   # axe-core accessibility scan
```

Then put the two URLs at the top of the root `README.md`, commit, and push.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser console: "blocked by CORS policy" | `CORS_ALLOWED_ORIGINS` on Render must exactly match the Vercel origin: `https://`, no trailing slash. |
| `400 Bad Request` from Render | `DJANGO_ALLOWED_HOSTS` must include `.onrender.com`. `RENDER_EXTERNAL_HOSTNAME` is also added automatically. |
| App says "Planning server unavailable" | Open `<api-url>/api/health` directly. If Render shows "Deploy failed", check the build logs; the Python version must be 3.12. |
| Routes use `osrm` instead of `openrouteservice` | `ORS_API_KEY` is missing or wrong on Render. The app still works, using car speeds. |
| A request takes more than 60 s | Public geocoders are rate-limited. Retry, or set `ORS_API_KEY` (much faster). |

### Railway instead of Render

New Project → Deploy from GitHub → set **Root Directory** to `backend`. Use the same start command
and the same variables, except set `DJANGO_ALLOWED_HOSTS=.up.railway.app`. Railway injects `PORT`
itself.
