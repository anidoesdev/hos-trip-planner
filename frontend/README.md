# HOS Trip Planner: Frontend

Vite + React 19 + TypeScript + Tailwind v4. See the [root README](../README.md) for the full
overview.

```bash
npm install
cp .env.example .env.local     # VITE_API_URL=http://127.0.0.1:8000
npm run dev                    # http://localhost:5173
npm run build                  # type-check + production build to dist/
node scripts/qa.mjs [url]      # end-to-end QA in Chrome (Playwright, uses installed Chrome)
node scripts/a11y.mjs [url]    # axe-core WCAG A/AA scan
```

| Path | What |
|---|---|
| `src/api/` | typed client: wakes a sleeping backend, timeouts, typed errors |
| `src/components/form/` | trip form, Photon autocomplete combobox, cycle slider, presets |
| `src/components/results/` | summary, Leaflet map (lazy-loaded), itinerary, loading/error/empty states |
| `src/components/logs/` | `DailyLogSheet` SVG, remarks layout, viewer (tabs, print), PDF export |
| `src/lib/` | formatting, stop types/colors, presets |
