"""
File storage — Supabase Storage in production, local disk locally.

Activates Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_KEY are set;
otherwise stores under a local uploads/ dir. save() returns an opaque locator;
local_path() resolves it to a path the extractors can read (downloading from
Supabase to a temp file when needed). app.py is storage-engine agnostic.
"""
from __future__ import annotations
import os, tempfile
from typing import Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = os.environ.get("SUPABASE_BUCKET", "uploads")
UPLOAD_DIR = os.environ.get("CIVILSPACE_UPLOADS", "uploads")

_USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)
if _USE_SUPABASE:
    from supabase import create_client
    _client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def save(pid: str, kind: str, filename: str, data: bytes) -> str:
    """Persist bytes; return a storage locator string."""
    key = f"{pid}/{kind}/{filename}"
    if _USE_SUPABASE:
        _client.storage.from_(BUCKET).upload(
            key, data, {"upsert": "true"})
        return f"supabase://{BUCKET}/{key}"
    dest = os.path.join(UPLOAD_DIR, f"{pid}__{kind}__{filename}")
    with open(dest, "wb") as f:
        f.write(data)
    return dest


def local_path(locator: str) -> str:
    """Resolve a locator to a local filesystem path the extractors can open.
    For Supabase, download to a temp file (extractors need a real path)."""
    if locator.startswith("supabase://"):
        rest = locator[len("supabase://"):]
        bucket, key = rest.split("/", 1)
        data = _client.storage.from_(bucket).download(key)
        suffix = os.path.splitext(key)[1] or ".bin"
        fd, tmp = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return tmp
    return locator


def backend_name() -> str:
    return "supabase-storage" if _USE_SUPABASE else "local-disk"
