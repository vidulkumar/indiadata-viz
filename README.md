# IndiaData.viz — Open-Source Indian Civic GIS & Verified Data Explorer

**Live Production URL:** [https://indiadata.orosant.com](https://indiadata.orosant.com)  
**Dedicated Dataset Upload Page:** [https://indiadata.orosant.com/upload](https://indiadata.orosant.com/upload)

---

## 1. Quick-Start Local Development & Verification Commands

You can develop, seed a local SQLite database (`data/indiadata-local.sqlite`), and verify everything on `localhost` before pushing code to GitHub.

### Prerequisites
- **Node.js 22+** (uses Node 22's built-in `node:sqlite` for zero-config local database persistence)

### Simple Commands

| Command | What It Does |
| :--- | :--- |
| `npm install` | Installs project dependencies. |
| `npm run db:seed` | Creates & seeds the local SQLite database (`data/indiadata-local.sqlite`) with all **740 verified GIS boundaries** (`7` Districts, `14` Lok Sabha PCs, `107` Assembly ACs, `612` Municipal Wards). |
| `npm run dev` | Seeds the local SQLite DB (if needed) and starts the local full-stack dev server + API at **`http://localhost:3000`** (Upload page at **`http://localhost:3000/upload`**). |
| `npm run verify` | **Run before `git push`:** Runs the automated local DB & zero-mock-data verification suite (`scripts/verify-local.mjs`), TypeScript typecheck (`tsc -b`), and production bundle build (`vite build`). |
| `npm run preview` | Serves the production build locally at **`http://localhost:3000`** backed by the local SQLite API. |

---

## 2. How Local Database Mode Works (`localhost`)

When running on `localhost` (`npm run dev` or `npm run preview`), Vite attaches a local SQLite middleware plugin ([vite.config.ts](./vite.config.ts) + [scripts/local-db.mjs](./scripts/local-db.mjs)) backed by `data/indiadata-local.sqlite` (WAL mode):

- `GET /api/local/status` — Health check and counts of local SQLite tables (`boundary_features`, `community_layers`, `insights`).
- `GET /api/local/boundaries?level=district|constituency|assembly|ward` — Serves the 740 survey-grade GIS boundary polygons directly from your local SQLite database.
- `GET /api/local/community-layers` & `POST /api/local/community-layers` — Stores datasets uploaded via `http://localhost:3000/upload` into your local SQLite database so you can test the entire upload-to-map flow offline or locally before pushing.
- `GET /api/datagov` & `GET /api/ckan` — Local CORS-safe proxies for `api.data.gov.in` and `data.opencity.in`.

In production (`https://indiadata.orosant.com`), the app automatically uses **Supabase PostgreSQL + PostGIS** (`public.boundary_features` & `public.community_layers`) and **Cloudflare Workers**.

---

## 3. Verified Data Sources (Zero Mock Data Policy)

1. **Default Visible Layers on Load:**
   - **Green & Forest Cover (`green_cover_pct`):** Sourced from the **Forest Survey of India — India State of Forest Report (ISFR 2023)**, Ministry of Environment, Forest and Climate Change ([https://fsi.nic.in/isfr-2023](https://fsi.nic.in/isfr-2023)).
   - **Air Pollution — CPCB AQI & PM2.5 (`aqi_pm25`, `pm25_ugm3`):** Sourced from **Central Pollution Control Board (CPCB) Continuous Ambient Air Quality Monitoring Stations (CAAQMS)** ([https://airquality.cpcb.gov.in/ccr/](https://airquality.cpcb.gov.in/ccr/) and [data.gov.in Resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69`](https://data.gov.in/resource/real-time-air-quality-index-various-locations)).
2. **Hover & Click Verification:**
   - **Hovering** over any polygon dynamically displays values for **all layers currently selected in the left panel**.
   - **Clicking** any polygon or CPCB station opens the right-hand verification panel with direct clickable links to the official data source, elected representative records (`Digital Sansad`, `Election Commission of India`, `MyNeta`, `State Election Commissions`), and GIS boundary repositories (`LGD` / `DataMeet`).
3. **Dedicated Dataset Upload Page (`/upload`):**
   - Contributors navigate to `/upload`, provide a required dataset explanation, official source verification URL (`https://...`), and select the target administrative level (`State Assembly Constituency`, `District`, `Lok Sabha PC`, `Municipal Ward`, or `GPS Points`).
   - Once published, the app redirects to the Home Map (`/`) with the uploaded dataset automatically selected in the Left Panel and rendered on the map.
