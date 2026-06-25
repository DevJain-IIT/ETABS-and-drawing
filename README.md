# CivilSpace — Column Rosetta Mapper

Reconciles a GFC drawing against an ETABS structural model: maps drawing columns
and primary beams to the model so an engineer can confirm matches and flag
discrepancies (human-in-the-loop).

```
civilspace-rosetta/
  backend/      FastAPI — extraction (Stage 0) + persistence. Supabase or SQLite.
  frontend/     Next.js 14 — the mapper UI (DBR design language).
  tools/
    parity_harness/   proves the TS engine == the original v10 engine (golden gate)
    review_agent/      screenshots the running app and reports UI issues
```

## Run locally (no Supabase needed)

One-time install:

```bash
cd backend  && pip install -r requirements.txt
cd ../frontend && npm install
```

Then start both servers:

- **Windows:** double-click `run_local.bat` (opens two terminals)
- **bash:** `./run_local.sh`

Open **http://localhost:3456** :
- `/upload` — create a project, upload an ETABS `.$et` + the GFC arrangement PDF
  (+ optional column-layout PDF), click **Upload & extract**.
- `/` — the mapper. Click **Refine & match**, **Name columns** (3-point align),
  **Add / delete columns**, toggle beams.
- `/?demo=1` or `/` with no project — the baked Gwalior demo.

Backend runs on **http://localhost:8765** (`/docs` for the API).
Without `SUPABASE_*` env vars it uses local SQLite (`civilspace.db`) + `uploads/`.

## Review the UI for issues

After the app is running:

```bash
cd tools/review_agent && node review.js http://localhost:3456
```

It screenshots every screen, checks for rendering problems, and writes a
human-readable report (`review_report.md` + annotated PNGs in `tools/probe/`).

## Verify the engine is faithful

```bash
cd tools/parity_harness && npm run parity   # TS engine == v10 oracle (empty diff)
cd backend && python test_pipeline.py        # extraction on real Gwalior files
```

## Go live (later)

Set `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`
on the backend and `NEXT_PUBLIC_API_BASE` on the frontend. Run
`backend/supabase_schema.sql` once. Deploy backend→Render, frontend→Vercel.
