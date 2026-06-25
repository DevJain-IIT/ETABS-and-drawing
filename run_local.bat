@echo off
REM Run the whole app locally on Windows: backend (8000) + frontend (3000).
REM Opens two terminal windows. Uses SQLite + local disk (no Supabase needed).
REM Ports 8765/3456 chosen to avoid colliding with other local projects.
echo == CivilSpace Rosetta - local ==
echo backend  -^> http://localhost:8765  (docs: /docs)
echo frontend -^> http://localhost:3456
echo.

REM Frontend runs in PRODUCTION mode (build once, then serve): pre-compiled, so
REM it won't hit the Next.js dev-mode "Jest worker" compile crash on heavy pages.
start "Rosetta backend" cmd /k "cd /d %~dp0backend && uvicorn app:app --port 8765 --reload"
start "Rosetta frontend" cmd /k "cd /d %~dp0frontend && set NEXT_PUBLIC_API_BASE=http://localhost:8765&& npm run build && npm run start -- --port 3456"

echo Two windows opened. Close them or press Ctrl-C in each to stop.
