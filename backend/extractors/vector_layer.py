"""
CivilSpace — PDF vector layer extractor.
=========================================
Extracts the full vector content of a PDF page as compact JSON so the browser
can render it natively on a canvas — crisp at any zoom, unlike a rasterized PNG.

Output shape (kept minimal for wire size):
{
  "page_w": 2384.0,   # PDF pt width
  "page_h": 1684.0,   # PDF pt height
  "paths":  [         # drawing paths (lines, quads, curves)
    {
      "fill":   "#b9b9b9" | null,
      "stroke": "#000000" | null,
      "width":  0.8,
      "items":  [
        ["l", x1, y1, x2, y2],               # line
        ["r", x0, y0, x1, y1],               # rect (two corners)
        ["c", x1,y1, x2,y2, x3,y3, x4,y4],  # cubic bezier (4 points)
      ]
    }, ...
  ],
  "texts": [          # text spans
    {"x": 123.0, "y": 456.0, "s": 8.0, "t": "C1", "c": "#000000"}
  ]
}

Wire size is typically 400–600 KB for a dense A0 column layout sheet — acceptable
for a one-time contract load. Paths are rounded to 2 decimal places.
"""
from __future__ import annotations
import fitz   # PyMuPDF


def _rgb(c) -> str | None:
    if c is None:
        return None
    r, g, b = c[0], c[1], c[2]
    return '#{:02x}{:02x}{:02x}'.format(int(r * 255), int(g * 255), int(b * 255))


def _r(v: float) -> float:
    return round(v, 1)   # 0.1 pt ≈ 0.035 mm — plenty for display


def extract_vectors(pdf_path: str, sheet: int = 0) -> dict:
    """Extract all vector paths and text spans from one PDF page as compact JSON."""
    doc = fitz.open(pdf_path)
    page = doc[sheet]
    pw, ph = page.rect.width, page.rect.height
    page_area = pw * ph

    paths = []
    for d in page.get_drawings():
        # skip invisible paths
        if d.get('fill') is None and d.get('color') is None:
            continue
        # skip large background fill rectangles (title block, border, viewport fill)
        # These cover >10% of page area and are not structural content.
        r = d.get('rect')
        if r and d.get('fill') is not None:
            rect_area = (r.x1 - r.x0) * (r.y1 - r.y0)
            if rect_area > page_area * 0.10:
                continue
        items = []
        for it in d.get('items', []):
            t = it[0]
            if t == 'l':
                p1, p2 = it[1], it[2]
                items.append(['l', _r(p1.x), _r(p1.y), _r(p2.x), _r(p2.y)])
            elif t == 'qu':
                q = it[1]   # fitz.Quad: ul, ur, ll, lr
                x0 = min(q.ul.x, q.ll.x); y0 = min(q.ul.y, q.ur.y)
                x1 = max(q.ur.x, q.lr.x); y1 = max(q.ll.y, q.lr.y)
                items.append(['r', _r(x0), _r(y0), _r(x1), _r(y1)])
            elif t == 'c':
                # cubic bezier: p1 (start), cp1, cp2, p2 (end)
                p1, cp1, cp2, p2 = it[1], it[2], it[3], it[4]
                items.append(['c', _r(p1.x), _r(p1.y), _r(cp1.x), _r(cp1.y),
                              _r(cp2.x), _r(cp2.y), _r(p2.x), _r(p2.y)])
        if not items:
            continue
        paths.append({
            'fill':   _rgb(d.get('fill')),
            'stroke': _rgb(d.get('color')),
            'width':  round(d.get('width') or 0.5, 2),
            'items':  items,
        })

    texts = []
    for b in page.get_text('dict', flags=fitz.TEXT_PRESERVE_WHITESPACE)['blocks']:
        if b['type'] != 0:
            continue
        for line in b['lines']:
            for sp in line['spans']:
                txt = sp['text'].strip()
                if not txt:
                    continue
                ox, oy = sp['origin']
                # PyMuPDF get_text('dict') returns origin in PDF space (y-up, bottom-left origin).
                # get_drawings() returns y-down (device space). Flip text y to match.
                oy = ph - oy
                c = sp.get('color', 0)
                r = (c >> 16) & 0xff; g = (c >> 8) & 0xff; bl = c & 0xff
                texts.append({
                    'x': _r(ox), 'y': _r(oy),
                    's': round(sp['size'], 1),
                    't': txt,
                    'c': '#{:02x}{:02x}{:02x}'.format(r, g, bl),
                })

    doc.close()
    return {'page_w': pw, 'page_h': ph, 'paths': paths, 'texts': texts}


if __name__ == '__main__':
    import sys, json
    data = extract_vectors(sys.argv[1])
    size_kb = len(json.dumps(data)) / 1024
    print(f"page {data['page_w']}x{data['page_h']} pt  "
          f"paths={len(data['paths'])}  texts={len(data['texts'])}  "
          f"JSON={size_kb:.0f} KB")
