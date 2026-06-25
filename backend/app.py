"""
CivilSpace — Rosetta Mapper backend (FastAPI)
=============================================
Stage-0 extraction + persistence only. The matching/verdict engine is
client-side (Rule 2: no server-side decisioning).

Persistence (db.py) and file storage (storage.py) auto-select Supabase in
production (when SUPABASE_* env vars are set) and SQLite + local disk for local
dev — the endpoints below are identical either way. Email-only identity.

Run:
    pip install -r requirements.txt
    uvicorn app:app --reload --port 8000        # docs at /docs

Flow:
    POST /projects {name,email}                 -> {id}
    POST /projects/{id}/files (etabs, gfc_pdf, layout_pdf, schedule_pdf)
    POST /projects/{id}/extract                 -> runs 3A+3B+3D+3C -> Contract
    GET  /projects/{id}/contract                -> the Contract the engine consumes
    POST /projects/{id}/contract  <Contract>    -> push a pre-built contract (demo/test)
    POST /projects/{id}/results  <decisions>    -> HITL verdicts + column add/delete
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

from contract import Contract
import extract as E
import db
import storage

db.init_db()

app = FastAPI(title="CivilSpace Rosetta backend", version="11.2")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


def _require(pid: str) -> dict:
    r = db.get_project(pid)
    if not r:
        raise HTTPException(404, "project not found")
    return r


# --------------------------------------------------------------------------- #
#  projects
# --------------------------------------------------------------------------- #
@app.post("/projects")
def create_project(payload: dict = Body(...)):
    return db.create_project(payload.get("name", "Untitled"), payload.get("email", ""))


@app.get("/projects")
def list_projects(email: str = ""):
    return db.list_projects(email)


@app.get("/projects/{pid}")
def get_project(pid: str):
    r = _require(pid)
    return {"id": r["id"], "name": r["name"], "status": r["status"],
            "has_contract": r.get("contract") is not None,
            "has_results": r.get("results") is not None}


# --------------------------------------------------------------------------- #
#  uploads
# --------------------------------------------------------------------------- #
@app.post("/projects/{pid}/files")
async def upload_files(pid: str,
                       etabs: UploadFile = File(None),
                       gfc_pdf: UploadFile = File(None),
                       layout_pdf: UploadFile = File(None),
                       floor_pdf: UploadFile = File(None),
                       schedule_pdf: UploadFile = File(None)):
    _require(pid)
    saved = {}
    for kind, f in (("etabs", etabs), ("gfc_pdf", gfc_pdf),
                    ("layout_pdf", layout_pdf), ("floor_pdf", floor_pdf),
                    ("schedule_pdf", schedule_pdf)):
        if f is None:
            continue
        locator = storage.save(pid, kind, f.filename, await f.read())
        db.add_file(pid, kind, locator)
        saved[kind] = locator
    return {"saved": saved}


# --------------------------------------------------------------------------- #
#  file download (raw PDF serving for browser PDF.js rendering)
# --------------------------------------------------------------------------- #
@app.get("/projects/{pid}/files/{kind}")
def download_file(pid: str, kind: str):
    _require(pid)
    files = db.get_files(pid)
    if kind not in files:
        raise HTTPException(404, f"no {kind!r} file uploaded for this project")
    path = storage.local_path(files[kind])
    return FileResponse(path, media_type="application/pdf",
                        headers={"Cache-Control": "private, max-age=86400"})


# --------------------------------------------------------------------------- #
#  extraction (Stage 0) -> Contract
# --------------------------------------------------------------------------- #
@app.post("/projects/{pid}/extract")
def run_extract(pid: str):
    r = _require(pid)
    files = db.get_files(pid)
    if "etabs" not in files or "gfc_pdf" not in files:
        raise HTTPException(400, "need at least an ETABS file and a GFC arrangement PDF")
    try:
        et_path = storage.local_path(files["etabs"])
        arr_path = storage.local_path(files["gfc_pdf"])
        lay_path = storage.local_path(files["layout_pdf"]) if "layout_pdf" in files else None
        flr_path = storage.local_path(files["floor_pdf"]) if "floor_pdf" in files else None
        contract = E.build_contract(project_name=r["name"], et_path=et_path,
                                    arrangement_pdf=arr_path, layout_pdf=lay_path,
                                    floor_pdf=flr_path)
        validated = Contract(**contract)
    except NotImplementedError as e:
        raise HTTPException(501, f"extractor seam not wired: {e}")
    except Exception as e:
        raise HTTPException(500, f"extraction failed: {e}")
    db.store_contract(pid, validated.model_dump())
    sched = validated.schedule
    return {"status": "extracted",
            "columns": len(validated.gfc_cols),
            "etabs_cols": len(validated.etabs_cols),
            "walls": len(validated.etabs_walls),
            "drawing_beams": len(validated.drawing_beams),
            "cmark_labels": sched.get("cmark_layer", {}).get("labels_found", 0),
            "review_boxes": len(sched.get("column_review", {}).get("rejected_boxes", []))}


# --------------------------------------------------------------------------- #
#  contract — push (demo/test) + GET the engine consumes
# --------------------------------------------------------------------------- #
@app.post("/projects/{pid}/contract")
def push_contract(pid: str, body: dict = Body(...)):
    _require(pid)
    c = Contract(**body)
    db.store_contract(pid, c.model_dump())
    return {"status": "extracted", "columns": len(c.gfc_cols)}


@app.get("/projects/{pid}/contract")
def get_contract(pid: str):
    _require(pid)
    c = db.get_contract(pid)
    if c is None:
        raise HTTPException(409, "not extracted yet — POST /extract or /contract first")
    return JSONResponse(c)


# --------------------------------------------------------------------------- #
#  HITL results (verdicts + column add/delete + name attachments)
# --------------------------------------------------------------------------- #
@app.post("/projects/{pid}/results")
def save_results(pid: str, body: dict = Body(...)):
    _require(pid)
    db.save_results(pid, body)
    return {"status": "saved", "decisions": len(body.get("decisions", {}))}


@app.get("/projects/{pid}/results")
def get_results(pid: str):
    _require(pid)
    return db.get_results(pid)


@app.get("/")
def root():
    return {"service": "CivilSpace Rosetta backend",
            "engine": "client-side / deterministic",
            "db": db.backend_name(), "storage": storage.backend_name(),
            "docs": "/docs"}
