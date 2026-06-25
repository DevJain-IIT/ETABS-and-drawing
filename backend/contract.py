"""
CivilSpace — v11 DATA CONTRACT (single source of truth)
========================================================
This is the *only* interface between the backend (extraction) and the v11
matching engine (client-side, deterministic). The engine consumes exactly these
arrays and nothing else. As long as the backend emits this shape, the engine
cannot tell baked Gwalior data from a fresh project upload — that is the firewall
that keeps the proven engine zero-change (see BUILD_SPEC §1).

Coordinate conventions (do not "fix" silently — the engine relies on them):
  - GFC columns/lines are in PDF points, y-DOWN (PyMuPDF convention).
  - ETABS columns/beams/walls are in model mm, y-UP.
  The reflection between the two is handled by the engine's reflection-aware
  similarity ICP. The backend must NOT pre-flip either side.

Threshold rule (Rule 1): the backend emits geometry only. Every match/verdict
threshold is RELATIVE and lives in the engine. The backend never bakes mm gates.
"""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class Img(BaseModel):
    w: int
    h: int
    src: str  # data URI ('data:image/png;base64,...') OR an http(s) URL the browser can load


class EtabsCol(BaseModel):
    id: str
    x: float
    y: float
    B: float            # section breadth (mm) — authoritative for orientation with D + ang
    D: float            # section depth   (mm)
    ang: float          # local-axis angle (deg)
    sec: str            # free-text section name (display only; never trusted for orientation)


class EtabsBeam(BaseModel):
    id: str
    x1: float; y1: float; x2: float; y2: float


class EtabsWall(BaseModel):
    """One ETABS pier segment. ETABS meshes one physical wall into SW2a/SW2b/...;
    keep every segment, do NOT pre-merge (engine does collinear-overlap matching)."""
    sw: str             # wall group, e.g. 'SW2'
    pier: str           # pier segment, e.g. 'SW2a'
    x1: float; y1: float; x2: float; y2: float
    thk: float          # thickness (mm)


class GfcCol(BaseModel):
    id: str             # stable per-sheet id, e.g. 'GFC_41' — NOT an identity, position is identity
    cx: float; cy: float
    rw: float; rh: float  # drawn rectangle width/height (PDF pts) — used for aspect-ratio classification


class ScheduleEntry(BaseModel):
    size_mm: dict       # {'w': float, 'h': float}
    # optional: rebar bands etc. carried opaquely
    class Config:
        extra = "allow"


class DrawingBeam(BaseModel):
    """A primary beam already collapsed from its two drawn face-lines and
    corridor-validated (BUILD_SPEC §0c + §3b). a/b are GFC column ids."""
    id: str
    a: str; b: str
    mark: Optional[str] = None      # e.g. 'PB19' (display/verify only)
    size: Optional[str] = None      # e.g. '230x900'
    faces: int = 2                  # how many face-lines collapsed (provenance)
    Lf: Optional[float] = None      # corridor coverage fraction (provenance)
    contiguous: Optional[bool] = None
    aligned: Optional[bool] = None


class SecondaryLine(BaseModel):
    id: str
    x1: float; y1: float; x2: float; y2: float
    mark: Optional[str] = None
    size: Optional[str] = None


class Contract(BaseModel):
    """Exactly what GET /projects/{id}/contract returns and v11.applyContract() consumes."""
    project_name: str
    img: Img
    etabs_cols: list[EtabsCol]
    etabs_beams: list[EtabsBeam]
    etabs_walls: list[EtabsWall]
    gfc_cols: list[GfcCol]
    gfc_cmark: dict[str, str]                 # gfc_id -> C-type
    gfc_cmark_flagged: list[str] = Field(default_factory=list)
    drawing_beams: list[DrawingBeam]
    secondary_draw: list[SecondaryLine] = Field(default_factory=list)

    # `schedule` is display/verify data (per-type size_mm + opaque extras like a
    # 'note' string). Kept free-form so real schedules validate without fuss.
    schedule: dict = Field(default_factory=dict)
