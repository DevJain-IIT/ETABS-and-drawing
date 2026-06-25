"""
Persistence layer — Supabase Postgres in production, SQLite locally.

Activates Postgres when SUPABASE_DB_URL (or DATABASE_URL) is set; otherwise falls
back to a local SQLite file so the app runs and is testable without credentials.
The public API (create_project, get_project, list_projects, save_files,
get_files, store_contract, get_contract, save_results, get_results) is identical
across both backends, so app.py never branches on the storage engine.

Tables (projects, files, results) carry user_email for the email-only identity.
"""
from __future__ import annotations
import json, os, sqlite3, time, uuid
from contextlib import closing
from typing import Optional

PG_URL = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
SQLITE_PATH = os.environ.get("CIVILSPACE_DB", "civilspace.db")

_USE_PG = bool(PG_URL)
if _USE_PG:
    import psycopg
    from psycopg.rows import dict_row


# --------------------------------------------------------------------------- #
#  connection
# --------------------------------------------------------------------------- #
def _connect():
    if _USE_PG:
        return psycopg.connect(PG_URL, row_factory=dict_row, autocommit=True)
    c = sqlite3.connect(SQLITE_PATH)
    c.row_factory = sqlite3.Row
    return c


def _ph(n: int) -> str:
    """Placeholder list for n params: %s for Postgres, ? for SQLite."""
    return ", ".join(["%s" if _USE_PG else "?"] * n)


def _q(sql: str) -> str:
    """Translate ? placeholders to %s when on Postgres."""
    return sql.replace("?", "%s") if _USE_PG else sql


def init_db():
    ddl_projects = """
        CREATE TABLE IF NOT EXISTS projects(
            id TEXT PRIMARY KEY, name TEXT, user_email TEXT, status TEXT,
            created DOUBLE PRECISION, contract TEXT, results TEXT)
    """ if _USE_PG else """
        CREATE TABLE IF NOT EXISTS projects(
            id TEXT PRIMARY KEY, name TEXT, user_email TEXT, status TEXT,
            created REAL, contract TEXT, results TEXT)
    """
    ddl_files = """
        CREATE TABLE IF NOT EXISTS files(
            id %s PRIMARY KEY %s, project_id TEXT, kind TEXT, path TEXT)
    """ % (("BIGSERIAL", "") if _USE_PG else ("INTEGER", "AUTOINCREMENT"))
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(ddl_projects)
        cur.execute(ddl_files)
        if not _USE_PG:
            c.commit()


# --------------------------------------------------------------------------- #
#  projects
# --------------------------------------------------------------------------- #
def create_project(name: str, email: str) -> dict:
    pid = uuid.uuid4().hex[:12]
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("INSERT INTO projects(id,name,user_email,status,created) VALUES(?,?,?,?,?)"),
                    (pid, name, (email or "").strip().lower(), "created", time.time()))
        if not _USE_PG:
            c.commit()
    return {"id": pid, "name": name, "status": "created"}


def get_project(pid: str) -> Optional[dict]:
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("SELECT * FROM projects WHERE id=?"), (pid,))
        r = cur.fetchone()
    return dict(r) if r else None


def list_projects(email: str = "") -> list[dict]:
    with closing(_connect()) as c:
        cur = c.cursor()
        if email:
            cur.execute(_q("SELECT id,name,status,created FROM projects WHERE user_email=? ORDER BY created DESC"),
                        (email.strip().lower(),))
        else:
            cur.execute("SELECT id,name,status,created FROM projects ORDER BY created DESC")
        return [dict(r) for r in cur.fetchall()]


def store_contract(pid: str, contract_dict: dict):
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("UPDATE projects SET contract=?, status=? WHERE id=?"),
                    (json.dumps(contract_dict), "extracted", pid))
        if not _USE_PG:
            c.commit()


def get_contract(pid: str) -> Optional[dict]:
    r = get_project(pid)
    if not r or not r.get("contract"):
        return None
    return json.loads(r["contract"])


def save_results(pid: str, body: dict):
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("UPDATE projects SET results=?, status=? WHERE id=?"),
                    (json.dumps(body), "reviewed", pid))
        if not _USE_PG:
            c.commit()


def get_results(pid: str) -> dict:
    r = get_project(pid)
    return json.loads(r["results"]) if r and r.get("results") else {}


# --------------------------------------------------------------------------- #
#  files
# --------------------------------------------------------------------------- #
def add_file(pid: str, kind: str, path: str):
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("INSERT INTO files(project_id,kind,path) VALUES(?,?,?)"), (pid, kind, path))
        if not _USE_PG:
            c.commit()


def get_files(pid: str) -> dict:
    with closing(_connect()) as c:
        cur = c.cursor()
        cur.execute(_q("SELECT kind,path FROM files WHERE project_id=?"), (pid,))
        return {r["kind"]: r["path"] for r in cur.fetchall()}


def backend_name() -> str:
    return "supabase-postgres" if _USE_PG else "sqlite"
