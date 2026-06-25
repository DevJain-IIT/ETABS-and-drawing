"""
CivilSpace ETABS Extractor — $et/$e2k -> Canonical JSON (schema v0.2.1)
Phase 1: text-file parsing. Same canonical output planned for OAPI in Phase 2.

Design rules (from schema v0.2.1):
- All output in canonical SI: mm, kN, kN/m, kN/m2, s. Source units recorded in meta.
- Every entity carries provenance: 1-based line numbers in the source file.
- Pattern ROLE classification is rule-based with confidence; mass/combo-relevant
  roles below threshold are queued for human confirmation.
- Extractor never decides code compliance. It only structures facts.
"""
import re, json, sys, hashlib
from collections import defaultdict, Counter

SCHEMA_VERSION = "0.2.1"
EXTRACTOR_VERSION = "0.1.0"

# ---------------------------------------------------------------- helpers
TOKEN = re.compile(r'"([^"]*)"|(\S+)')

def toks(line):
    return [m.group(1) if m.group(1) is not None else m.group(2)
            for m in TOKEN.finditer(line)]

def kv(tokens, key, cast=str, default=None):
    """Find KEY value in a token list (ETABS style: KEY value)."""
    for i, t in enumerate(tokens[:-1]):
        if t == key:
            try:
                return cast(tokens[i + 1])
            except (ValueError, TypeError):
                return default
    return default

class Prov:
    """provenance helper: store line numbers per entity id"""
    def __init__(self):
        self.map = defaultdict(list)
    def add(self, eid, lineno):
        self.map[eid].append(lineno)
    def get(self, eid):
        return self.map.get(eid, [])

# ---------------------------------------------------------------- units
def detect_units(lines):
    for ln in lines[:40]:
        m = re.search(r'UNITS\s+"?(KN|N|KIP|LB|TONF)"?\s+"?(MM|M|CM|IN|FT)"?', ln, re.I)
        if m:
            return m.group(1).upper(), m.group(2).upper()
    return "N", "MM"   # ETABS $et default observed in models 1-2

def unit_factors(force_u, len_u):
    f = {"N": 1e-3, "KN": 1.0, "TONF": 9.80665}[force_u]      # -> kN
    L = {"MM": 1.0, "CM": 10.0, "M": 1000.0}[len_u]           # -> mm
    return {
        "force_kN": f, "len_mm": L,
        "lineload_kN_m": f / (L / 1000.0),                     # F/L -> kN/m
        "areaload_kN_m2": f / (L / 1000.0) ** 2,               # F/L^2 -> kN/m2
        "density_kN_m3": f / (L / 1000.0) ** 3,
    }

# ---------------------------------------------------------------- role classifier
MASS_COMBO_RELEVANT = {"DEAD_SELF", "SDL_FINISH", "SDL_WALL", "SDL_SUNK_FILL",
                       "SDL_EARTH", "SDL_OTHER", "LIVE_LE3", "LIVE_GT3", "LIVE_ROOF"}

def ln_safe(n):
    return n

def classify_role(name, etabs_type, max_area_load_kn_m2):
    """Return (role, confidence). Rule-based v0."""
    n = name.upper()
    t = (etabs_type or "").upper()
    if t == "DEAD":
        return "DEAD_SELF", 0.99
    if t == "SEISMIC" or n.startswith(("EQ", "SPEC", "RQ")):
        return "EQ_STATIC", 0.97
    if t == "WIND" or n.startswith(("WIND", "WX", "WY", "WN")):
        return "WIND", 0.97
    if "TEMP" in n or t == "TEMPERATURE":
        return "TEMP", 0.95
    if "SHRINK" in n:
        return "SHRINKAGE", 0.95
    if t in ("SUPER DEAD", "SUPERDEAD") or n in ("SIDL", "SDL", "FF"):
        if "WALL" in n:
            return "SDL_WALL", 0.95
        if "SUNK" in n:
            return "SDL_SUNK_FILL", 0.95
        if n in ("FF",) or "FINISH" in n or n in ("SIDL", "SDL"):
            return "SDL_FINISH", 0.9
        return "SDL_OTHER", 0.7
    if "WALL" in n:
        return "SDL_WALL", 0.9
    if "SUNK" in n:
        return "SDL_SUNK_FILL", 0.9
    if n in ("E+S+A", "EP") or "EARTH PRESSURE" in n or ("EARTH" in n and "SURCHARGE" in ln_safe(n)):
        return "EARTH_PRESSURE", 0.85
    if n in ("OHT", "WT", "TANK") or "TANK" in n or "FLUID" in n or "WATER" in n:
        return "FLUID_RETAINING", 0.85
    if "FILL" in n or "EARTH" in n:
        return "SDL_EARTH", 0.75
    if "ROOF" in n and ("LIVE" in n or "LL" in n or t.startswith("ROOF")):
        return "LIVE_ROOF", 0.95
    if t in ("LIVE", "REDUCIBLE LIVE") or "LIVE" in n or n.endswith("LL") or n.startswith("LL"):
        # magnitude split where evidence exists
        if "<" in n or "LE" in n:
            return "LIVE_LE3", 0.95
        if ">" in n or "GT" in n:
            return "LIVE_GT3", 0.95
        if max_area_load_kn_m2 is not None:
            return ("LIVE_GT3" if max_area_load_kn_m2 > 3.0 else "LIVE_LE3"), 0.8
        return "LIVE_LE3", 0.55
    return "OTHER", 0.4

# ---------------------------------------------------------------- main parse
def parse(path):
    raw = open(path, encoding="utf-8", errors="replace").read().splitlines()
    force_u, len_u = detect_units(raw)
    U = unit_factors(force_u, len_u)
    prov = Prov()

    out = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "extractor_version": EXTRACTOR_VERSION,
            "source_file": path,
            "source_file_saved_at": None,
            "etabs_version": None,
            "source_units": {"force": force_u, "length": len_u},
            "parse_warnings": [],
        },
        "stories": [], "base_elev_mm": None,
        "materials": [], "frame_sections": [], "shell_sections": [],
        "members": {"columns": [], "beams": [], "walls_panels": [], "floors": []},
        "points": {}, "diaphragms": [],
        "load_patterns": [], "seismic_definitions": [], "spectrum_functions": [],
        "load_cases": [], "combos": [],
        "mass_source": {"loads": [], "include_lateral": None,
                        "include_vertical": None, "lump_at_stories": None},
        "analysis_options": {"pdelta_method": None, "pdelta_load_terms": [],
                             "floor_mesh_max_mm": None, "wall_mesh_max_mm": None},
        "design_preferences": {},
        "applied_loads": {"line_loads": [], "area_loads": [],
                          "point_loads": [], "user_wind_loads": []},
        "plan_geometry": {},
        "provenance": {},
    }

    # header
    m = re.search(r'saved (\d+/\d+/\d+ [\d:]+ [AP]M)', raw[0]) if raw else None
    if m:
        out["meta"]["source_file_saved_at"] = m.group(1)
    for ln in raw[:6]:
        m = re.search(r'PROGRAM\s+"ETABS"\s+VERSION\s+"([^"]+)"', ln)
        if m:
            out["meta"]["etabs_version"] = m.group(1)

    areas_raw = {}                      # name -> (type, [verts])
    area_assign = defaultdict(list)     # name -> [(story, section, diaph)]
    line_assign = defaultdict(list)     # name -> [(story, dict)]
    lines_raw = {}                      # name -> (class, pi, pj)
    pat_applied = Counter()             # pattern -> applied load count
    pat_max_area = {}                   # pattern -> max area load kN/m2
    pat_meta = {}                       # name -> dict (raw)
    restr = defaultdict(dict)           # story -> {pt: restraint}

    for i, rawline in enumerate(raw, 1):
        ln = rawline.strip()
        if not ln or ln.startswith("$"):
            continue
        T = toks(ln)
        head = T[0]

        if head == "STORY" and "HEIGHT" in T:
            h = kv(T, "HEIGHT", float)
            out["stories"].append({"name": T[1], "height_mm": h * U["len_mm"],
                                   "is_master": "MASTERSTORY" in ln,
                                   "similar_to": kv(T, "SIMILARTO")})
            prov.add(f"story:{T[1]}", i)
        elif head == "STORY" and "ELEV" in T:
            out["base_elev_mm"] = kv(T, "ELEV", float) * U["len_mm"]

        elif head == "MATERIAL" and "TYPE" in T:
            out["materials"].append({
                "name": T[1], "type": kv(T, "TYPE"),
                "unit_weight_kn_m3": (kv(T, "WEIGHTPERVOLUME", float) or 0) * U["density_kN_m3"] or None,
                "E_mpa": kv(T, "E", float)})
            prov.add(f"mat:{T[1]}", i)

        elif head == "FRAMESECTION":
            name = T[1]
            sec = next((s for s in out["frame_sections"] if s["name"] == name), None)
            if sec is None:
                sec = {"name": name, "shape": None, "material": None,
                       "depth_t3_mm": None, "width_t2_mm": None,
                       "modifiers": {}, "concrete_design": {}}
                out["frame_sections"].append(sec)
            if "MATERIAL" in T:
                sec["material"] = kv(T, "MATERIAL")
                sec["shape"] = kv(T, "SHAPE")
                d, b = kv(T, "D", float), kv(T, "B", float)
                if d is not None:
                    sec["depth_t3_mm"] = d * U["len_mm"]
                if b is not None:
                    sec["width_t2_mm"] = b * U["len_mm"]
            for mk, sk in (("I2MOD", "I2"), ("I3MOD", "I3"), ("JMOD", "J"), ("AMOD", "A")):
                v = kv(T, mk, float)
                if v is not None:
                    sec["modifiers"][sk] = v
            for ck, sk in (("COVERTOP", "cover_top_mm"), ("COVERBOTTOM", "cover_bottom_mm"),
                           ("COVER", "cover_mm")):
                v = kv(T, ck, float)
                if v is not None:
                    sec["concrete_design"][sk] = v * U["len_mm"]
            ctype = kv(T, "CONCRETETYPE") or kv(T, "DESIGNTYPE")
            if ctype:
                sec["concrete_design"]["type"] = ctype
            prov.add(f"fsec:{name}", i)

        elif head == "SHELLPROP":
            name = T[1]
            sp = next((s for s in out["shell_sections"] if s["name"] == name), None)
            if sp is None:
                sp = {"name": name, "prop_type": None, "modeling_type": None,
                      "thickness_mm": None, "material": None, "modifiers": {}}
                out["shell_sections"].append(sp)
            if "PROPTYPE" in T:
                sp["prop_type"] = kv(T, "PROPTYPE")
                sp["modeling_type"] = kv(T, "MODELINGTYPE")
                sp["material"] = kv(T, "MATERIAL")
                th = kv(T, "SLABTHICKNESS", float) or kv(T, "WALLTHICKNESS", float) or kv(T, "THICKNESS", float)
                if th:
                    sp["thickness_mm"] = th * U["len_mm"]
            for mk in ("F11MOD", "F22MOD", "F12MOD", "M11MOD", "M22MOD", "M12MOD"):
                v = kv(T, mk, float)
                if v is not None:
                    sp["modifiers"][mk[:3]] = v
            prov.add(f"ssec:{name}", i)

        elif head == "POINT" and len(T) >= 4:
            try:
                out["points"][T[1]] = {"x_mm": float(T[2]) * U["len_mm"],
                                       "y_mm": float(T[3]) * U["len_mm"],
                                       "restraints_by_story": {}}
            except ValueError:
                pass

        elif head == "LINE" and len(T) >= 5 and T[2] in ("COLUMN", "BEAM", "BRACE"):
            lines_raw[T[1]] = (T[2], T[3], T[4])
            prov.add(f"line:{T[1]}", i)

        elif head == "AREA" and len(T) >= 4 and T[2] in ("FLOOR", "PANEL", "WALL", "AREA"):
            try:
                nv = int(T[3])
                areas_raw[T[1]] = (T[2], T[4:4 + nv])
                prov.add(f"area:{T[1]}", i)
            except ValueError:
                pass

        elif head == "AREAASSIGN":
            area_assign[T[1]].append({"story": T[2], "section": kv(T, "SECTION"),
                                      "diaph": kv(T, "DIAPH"), "pier": kv(T, "PIER"),
                                      "line": i})

        elif head == "LINEASSIGN":
            d = {"story": T[2], "section": kv(T, "SECTION"),
                 "ang": kv(T, "ANG", float), "release": kv(T, "RELEASE"),
                 "line": i}
            for k in ("OFFSETI", "OFFSETJ", "RIGIDZONE"):
                v = kv(T, k, float)
                if v is not None:
                    d[k.lower()] = v
            if "LOCALAXIS" in ln.upper():
                d["local_axes_override"] = ln
            line_assign[T[1]].append(d)

        elif head == "POINTASSIGN":
            r = kv(T, "RESTRAINT")
            if r:
                restr[T[2]][T[1]] = r
                if T[1] in out["points"]:
                    out["points"][T[1]]["restraints_by_story"][T[2]] = r
            dia = kv(T, "DIAPH")
            if dia and T[1] in out["points"]:
                out["points"][T[1]].setdefault("diaphragm_by_story", {})[T[2]] = \
                    {"diaphragm": dia, "source": "point_assigned"}

        elif head == "DIAPHRAGM":
            out["diaphragms"].append({"name": T[1],
                                      "type": "RIGID" if "RIGID" in ln.upper() and "SEMI" not in ln.upper()
                                      else ("SEMIRIGID" if "SEMI" in ln.upper() else None)})

        elif head == "LOADPATTERN" or (head == "LOADCASE" and "TYPE" in T and
                                       kv(T, "TYPE") in ("DEAD", "SUPER DEAD", "LIVE",
                                                         "REDUCIBLE LIVE", "ROOF LIVE",
                                                         "QUAKE", "SEISMIC", "WIND",
                                                         "TEMPERATURE", "OTHER")):
            # ETABS 9-style uses LOADCASE for patterns; 21 uses LOADPATTERN
            name = T[1]
            pat_meta[name] = {"etabs_type": kv(T, "TYPE"),
                              "sw": kv(T, "SELFWEIGHT", float), "line": i}

        elif head == "SEISMIC":
            sd = {"pattern": T[1],
                  "direction": "X" if "X" in (kv(T, "DIR") or T[1]).upper() else "Y",
                  "ecc_ratio": kv(T, "ECC", float) or kv(T, "ECCRATIO", float) or 0.0,
                  "top_story": kv(T, "TOPSTORY"), "bottom_story": kv(T, "BOTTOMSTORY"),
                  "period_type": "USER" if "USERT" in ln.upper() else "PROGCALC",
                  "user_T_s": kv(T, "USERT", float),
                  "Z": kv(T, "Z", float), "I": kv(T, "I", float),
                  "soil": kv(T, "S"), "R": kv(T, "R", float)}
            dirraw = (kv(T, "DIR") or "").upper()
            sd["ecc_sign"] = "+" if "+ECC" in dirraw else ("-" if "-ECC" in dirraw else "0")
            out["seismic_definitions"].append(sd)
            prov.add(f"seis:{T[1]}", i)

        elif head == "FUNCTION" and kv(T, "FUNCTYPE") == "SPECTRUM":
            out["spectrum_functions"].append({
                "name": T[1], "spec_type": kv(T, "SPECTYPE") or "USER",
                "damping": kv(T, "DAMPRATIO", float),
                "zone": kv(T, "ZONE"), "soil": kv(T, "SOILTYPE"),
                "Z": kv(T, "INZ", float), "I": kv(T, "I", float),
                "R": kv(T, "R", float), "used_by_any_case": False})
            prov.add(f"func:{T[1]}", i)

        elif head == "LOADCASE" and kv(T, "TYPE") in ("Response Spectrum", "Modal - Eigen",
                                                      "Modal - Ritz", "Linear Static",
                                                      "Nonlinear Static"):
            name = T[1]
            lc = next((c for c in out["load_cases"] if c["name"] == name), None)
            if lc is None:
                lc = {"name": name, "type": kv(T, "TYPE"), "rs": {}}
                out["load_cases"].append(lc)
        elif head == "LOADCASE":
            name = T[1]
            lc = next((c for c in out["load_cases"] if c["name"] == name), None)
            if lc is None:
                lc = {"name": name, "type": None, "rs": {}}
                out["load_cases"].append(lc)
            if "ACCEL" in T:
                lc["rs"]["accel_dir"] = kv(T, "ACCEL")
                lc["rs"]["function"] = kv(T, "FUNC")
                sf = kv(T, "SF", float)
                lc["rs"]["scale_factor"] = sf
            if "ECCENRATIOTYPICAL" in T:
                lc["rs"]["ecc_ratio"] = kv(T, "ECCENRATIOTYPICAL", float)
            if "MAXMODES" in T or "MODES" in ln.upper():
                v = kv(T, "MAXMODES", int)
                if v:
                    lc["modal_max_modes"] = v

        elif head == "COMBO":
            name = T[1]
            cb = next((c for c in out["combos"] if c["name"] == name), None)
            if cb is None:
                cb = {"name": name, "combo_type": None, "terms": []}
                out["combos"].append(cb)
            if "TYPE" in T and kv(T, "TYPE") in ("Linear Add", "Envelope", "SRSS",
                                                 "Absolute Add", "Range Add"):
                cb["combo_type"] = kv(T, "TYPE")
            if "LOADCASE" in T:
                cb["terms"].append({"case": kv(T, "LOADCASE"), "sf": kv(T, "SF", float)})
            if "LOADCOMBO" in T:
                cb["terms"].append({"combo": kv(T, "LOADCOMBO"), "sf": kv(T, "SF", float)})
            prov.add(f"combo:{name}", i)

        elif head == "MASSSOURCELOAD" or (head == "MASSSOURCE" and "LOADPATTERN" in ln.upper()):
            # forms: MASSSOURCELOAD "src" "pattern" factor
            try:
                out["mass_source"]["loads"].append({"pattern": T[2], "factor": float(T[3])})
            except (IndexError, ValueError):
                pass
        elif head == "MASSSOURCE":
            for k, f in (("INCLUDELATERALMASS", "include_lateral"),
                         ("INCLUDEVERTICALMASS", "include_vertical"),
                         ("LUMPMASSATSTORIES", "lump_at_stories")):
                v = kv(T, k)
                if v is not None:
                    out["mass_source"][f] = (v.upper() == "YES")

        elif "PDELTA" in ln.upper() and "METHOD" in ln.upper():
            m = re.search(r'PDELTA\s*METHOD\s*"([^"]+)"', ln, re.I)
            if m:
                out["analysis_options"]["pdelta_method"] = m.group(1).upper()
        elif head == "CONCRETEPREFERENCE" or "PDELTADONE" in ln.upper() or "DESIGNFORBCCR" in ln.upper():
            for k, f in (("PDELTADONE", "pdelta_done_flag"), ("DESIGNFORBCCR", "bccr"),
                         ("CODE", "concrete_code")):
                m = re.search(k + r'\s+"([^"]+)"', ln)
                if m:
                    out["design_preferences"][f] = m.group(1)

        # ----- applied loads
        elif head == "LINELOAD":
            pat = kv(T, "LC")
            v = kv(T, "FVAL", float)
            if pat:
                pat_applied[pat] += 1
            if pat and v is not None:
                out["applied_loads"]["line_loads"].append(
                    {"member": T[1], "story": T[2], "pattern": pat,
                     "value_kn_m": v * U["lineload_kN_m"], "line": i})
        elif head == "AREALOAD":
            pat = kv(T, "LC")
            v = kv(T, "FVAL", float)
            if pat:
                pat_applied[pat] += 1
            if pat and v is not None:
                v2 = v * U["areaload_kN_m2"]
                out["applied_loads"]["area_loads"].append(
                    {"area": T[1], "story": T[2], "pattern": pat,
                     "value_kn_m2": v2, "line": i})
                pat_max_area[pat] = max(pat_max_area.get(pat, 0), v2)
        elif head == "POINTLOAD":
            pat = kv(T, "LC")
            if pat:
                pat_applied[pat] += 1
        elif head == "WIND" and ("875" in ln or "ASCE" in ln or "AUTO" in ln.upper()):
            pat_meta.setdefault(T[1], {"etabs_type": "WIND", "sw": None, "line": i})
            pat_meta[T[1]]["auto_lateral"] = True
            pat_meta[T[1]]["auto_wind_params"] = {
                "code": T[2], "vb": kv(T, "VB", float),
                "terrain": kv(T, "TERRAIN"), "k1": kv(T, "K1", float),
                "k3": kv(T, "K3", float), "windward_cp": kv(T, "WINDWARDCP", float),
                "leeward_cp": kv(T, "LEEWARDCP", float)}
        elif head == "WIND" and "USERLOAD" in ln.upper():
            pat = T[1]
            pat_applied[pat] += 1
            out["applied_loads"]["user_wind_loads"].append(
                {"pattern": pat, "story": kv(T, '"USERLOAD"') or (T[4] if len(T) > 4 else None),
                 "fx_kn": (kv(T, "FX", float) or 0) * U["force_kN"],
                 "fy_kn": (kv(T, "FY", float) or 0) * U["force_kN"], "line": i})

    # ---------------- assemble members
    colsec_by_line = {}
    for name, (cls, pi, pj) in lines_raw.items():
        assigns = line_assign.get(name, [])
        stories = [a["story"] for a in assigns]
        secs = sorted({a["section"] for a in assigns if a["section"]})
        rel = sorted({a["release"] for a in assigns if a.get("release")})
        ang = sorted({a["ang"] for a in assigns if a.get("ang") is not None})
        lax = [a["local_axes_override"] for a in assigns if "local_axes_override" in a]
        ent = {"id": name, "stories": stories, "sections": secs,
               "pt_i": pi, "pt_j": pj,
               "angle_deg": ang[0] if len(ang) == 1 else (ang or 0.0),
               "releases": rel or None,
               "local_axes_override": {"present": bool(lax), "raw": lax[0] if lax else None},
               "end_offsets": {k: a.get(k) for a in assigns[:1]
                               for k in ("offseti", "offsetj", "rigidzone") if a.get(k)} or None}
        if cls == "COLUMN":
            p = out["points"].get(pi)
            ent["plan_xy_mm"] = [p["x_mm"], p["y_mm"]] if p else None
            lowest = stories[-1] if stories else None
            base_r = restr.get("Base", {}).get(pi)
            ent["base_restraint"] = base_r
            ent["is_planted"] = base_r is None and bool(stories)
            out["members"]["columns"].append(ent)
        else:
            P, Q = out["points"].get(pi), out["points"].get(pj)
            if P and Q:
                ent["span_mm"] = ((P["x_mm"] - Q["x_mm"]) ** 2 +
                                  (P["y_mm"] - Q["y_mm"]) ** 2) ** 0.5
            out["members"]["beams"].append(ent)

    colpts = {c["pt_i"] for c in out["members"]["columns"]}
    for b in out["members"]["beams"]:
        b["beam_supported_ends"] = sum(1 for p in (b["pt_i"], b["pt_j"]) if p not in colpts)

    for name, (atype, verts) in areas_raw.items():
        assigns = area_assign.get(name, [])
        ent = {"id": name, "vertices": verts,
               "stories": [a["story"] for a in assigns],
               "sections": sorted({a["section"] for a in assigns if a["section"]}),
               "diaphragm": next((a["diaph"] for a in assigns if a["diaph"]), None),
               "pier_label": next((a["pier"] for a in assigns if a.get("pier")), None),
               "vertex_set_hash": hashlib.md5(("|".join(sorted(set(verts)))).encode()).hexdigest()[:10]}
        pts = [out["points"].get(v) for v in verts]
        if all(pts):
            A = 0.0
            for k in range(len(pts)):
                x1, y1 = pts[k]["x_mm"], pts[k]["y_mm"]
                x2, y2 = pts[(k + 1) % len(pts)]["x_mm"], pts[(k + 1) % len(pts)]["y_mm"]
                A += x1 * y2 - x2 * y1
            ent["area_m2"] = abs(A) / 2 / 1e6
        (out["members"]["floors"] if atype == "FLOOR"
         else out["members"]["walls_panels"]).append(ent)

    # ---------------- load patterns + roles
    for name, m in pat_meta.items():
        role, conf = classify_role(name, m["etabs_type"], pat_max_area.get(name))
        out["load_patterns"].append({
            "name": name, "etabs_type": m["etabs_type"], "role": role,
            "auto_lateral": m.get("auto_lateral", False),
            "auto_wind_params": m.get("auto_wind_params"),
            "role_confidence": conf,
            "role_confirmation": ("human_required"
                                  if role in MASS_COMBO_RELEVANT and conf < 0.85
                                  else "auto"),
            "self_weight_multiplier": m["sw"],
            "applied_load_count": pat_applied.get(name, 0),
            "provenance": [m["line"]]})

    # spectrum function usage
    used = {c["rs"].get("function") for c in out["load_cases"] if c.get("rs")}
    for f in out["spectrum_functions"]:
        f["used_by_any_case"] = f["name"] in used
    for c in out["load_cases"]:
        sf = c.get("rs", {}).get("scale_factor")
        if sf:
            g = 9.80665 * (1000.0 / U["len_mm"])  # g in source length units/s2 -> but sf in model units
            c["rs"]["scale_over_g"] = round(sf / (9806.65 if U["len_mm"] == 1.0 else 9.80665), 4)

    # plan geometry
    if out["points"]:
        xs = [p["x_mm"] for p in out["points"].values()]
        ys = [p["y_mm"] for p in out["points"].values()]
        ex, ey = max(xs) - min(xs), max(ys) - min(ys)
        out["plan_geometry"] = {"envelope_x_mm": ex, "envelope_y_mm": ey,
                                "aspect_ratio": round(max(ex, ey) / max(min(ex, ey), 1), 3),
                                "slab_coverage_by_story": []}
        cov = defaultdict(float)
        for fl in out["members"]["floors"]:
            for s in fl["stories"]:
                cov[s] += fl.get("area_m2", 0)
        out["plan_geometry"]["slab_coverage_by_story"] = [
            {"story": s, "slab_area_m2": round(a, 1)} for s, a in cov.items()]

    out["provenance"] = {k: v for k, v in prov.map.items()}
    return out


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    model = parse(src)
    json.dump(model, open(dst, "w"), indent=1)
    print(f"{src} -> {dst}: stories={len(model['stories'])} cols={len(model['members']['columns'])} "
          f"beams={len(model['members']['beams'])} patterns={len(model['load_patterns'])} "
          f"combos={len(model['combos'])} units={model['meta']['source_units']}")
