#!/usr/bin/env python3
"""Scan + print web UI for printmanager.

Two tools on one page:
  * Scan  — a Scan button + a table of recent scans (thumbnail, name, DPI, size,
    per-file download / rename / remove). Each scan runs the server-side pipeline
    (Brother's driver over the saned net bridge) and drops a PDF into the share.
  * Print — a label-sheet printer: pick an A4 label layout, click the cells on the
    rendered sheet, drop in text (e.g. a number) or an image/PDF, and it composes
    an A4 PDF and submits it to the local CUPS queue.

Stdlib only, except reportlab/Pillow (imported lazily, and only on the print
path) and PyYAML (to read the config file).

Config is loaded from a YAML file (path in SCAN_WEB_CONFIG, default
/usr/local/lib/scan-web/config.yaml) that the Tack role renders from its
variables. Per-key environment fallbacks are kept so the app can still be run
directly for local development without a config file."""
import os
import re
import io
import json
import time
import html
import base64
import shutil
import tempfile
import urllib.parse
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _load_config():
    path = os.environ.get("SCAN_WEB_CONFIG", "/usr/local/lib/scan-web/config.yaml")
    try:
        import yaml
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


CFG = _load_config()


def _cfg(key, env, default):
    """Config precedence: YAML file -> environment -> default."""
    if CFG.get(key) is not None:
        return CFG[key]
    v = os.environ.get(env)
    return v if v is not None else default


def _cfg_bool(key, env, default):
    return str(_cfg(key, env, default)).strip().lower() in ("1", "true", "yes", "on")


SCAN_DIR = _cfg("dir", "SCAN_WEB_DIR", "/srv/scans")
DATA_DIR = _cfg("data", "SCAN_WEB_DATA", "/var/lib/scan-web")
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")
META_DIR = os.path.join(DATA_DIR, "meta")
PORT = int(_cfg("port", "SCAN_WEB_PORT", 8080))
TITLE = _cfg("title", "SCAN_WEB_TITLE", "printmanager")
SHARE = _cfg("share", "SCAN_WEB_SHARE", "smb://printmanager.local/scans")
SCRIPT = _cfg("script", "SCAN_WEB_SCRIPT", "/usr/local/lib/scan-web/scan-to-share.sh")
DEF_MODE = _cfg("default_mode", "SCAN_WEB_DEFAULT_MODE", "24bit Color")
DEF_RES = str(_cfg("default_res", "SCAN_WEB_DEFAULT_RES", "300"))

PRINT_ENABLED = _cfg_bool("print_enabled", "SCAN_WEB_PRINT_ENABLED", "true")
PRINT_QUEUE = _cfg("print_queue", "SCAN_WEB_PRINT_QUEUE", "DCP1511")

DEVICES_ENABLED = _cfg_bool("devices_enabled", "SCAN_WEB_DEVICES_ENABLED", "true")

# The Niimbot module reads its store dir from SCAN_WEB_DATA; keep it in sync with
# the resolved config so both agree when config comes from the YAML file.
os.environ["SCAN_WEB_DATA"] = DATA_DIR

MODES = [("24bit Color", "Color"), ("True Gray", "Gray"), ("Black & White", "Black & white")]
MODE_VALUES = [m[0] for m in MODES]
RESOLUTIONS = ["150", "200", "300", "400", "600"]
NAME_RE = re.compile(r"[A-Za-z0-9._-]+")
SAFE_RE = re.compile(r"[^A-Za-z0-9 _-]+")
# Grid-derived sheet names like "A4 · 8 labels (2×4)"; auto-corrected to the real
# columns×rows on save so a preset name can't go stale if the client didn't sync.
_GRID_NAME = re.compile("^A4 · \\d+ labels \\(\\d+×\\d+\\)$")

# --- Label sheets: built-in presets + user-managed sheets --------------------
# Built-in A4 presets (mm, approximate real stock). The UI can edit ANY sheet
# (presets included — margins usually need a test print or two to dial in) and
# add new ones; changes persist to TEMPLATES_FILE. Editing a preset stores an
# override under its id; "reset" drops the override and restores the seed here.
# Sheets use symmetric margins: right = left, bottom = top, so cell size is
# derived. Override the built-in seed wholesale via SCAN_WEB_LABEL_TEMPLATES.
PAGE_W, PAGE_H = 210.0, 297.0        # A4 default page size (stored per template)
MIN_CELL_MM = 5.0
TEMPLATES_FILE = os.path.join(DATA_DIR, "sheets.json")

DEFAULT_TEMPLATES = [
    {"id": "a4-44", "name": "A4 · 44 labels (4×11)", "cols": 4, "rows": 11,
     "cell_w": 48.5, "cell_h": 25.4, "margin_l": 7, "margin_t": 10, "gap_x": 0, "gap_y": 0},
    {"id": "a4-32", "name": "A4 · 32 labels (4×8)", "cols": 4, "rows": 8,
     "cell_w": 48.5, "cell_h": 35.0, "margin_l": 7, "margin_t": 9, "gap_x": 0, "gap_y": 0},
    {"id": "a4-21", "name": "A4 · 21 labels (3×7)", "cols": 3, "rows": 7,
     "cell_w": 63.5, "cell_h": 38.1, "margin_l": 7, "margin_t": 15, "gap_x": 3, "gap_y": 0},
    {"id": "a4-8", "name": "A4 · 8 labels (2×4)", "cols": 2, "rows": 4,
     "cell_w": 99.1, "cell_h": 67.7, "margin_l": 6, "margin_t": 13, "gap_x": 0, "gap_y": 0},
]

_TEMPLATE_KEYS = ("id", "name", "cols", "rows", "margin_l", "margin_t",
                  "gap_x", "gap_y", "cell_w", "cell_h", "page_w", "page_h")


def _with_defaults(t):
    t = dict(t)
    t.setdefault("page_w", PAGE_W)
    t.setdefault("page_h", PAGE_H)
    t.setdefault("gap_x", 0)
    t.setdefault("gap_y", 0)
    return t


try:
    _tj = os.environ.get("SCAN_WEB_LABEL_TEMPLATES")
    _BUILTIN_SRC = json.loads(_tj) if _tj else DEFAULT_TEMPLATES
except Exception:
    _BUILTIN_SRC = DEFAULT_TEMPLATES
BUILTIN_TEMPLATES = [_with_defaults(t) for t in _BUILTIN_SRC]
BUILTIN_IDS = {t["id"] for t in BUILTIN_TEMPLATES}

LABEL_TEMPLATES = list(BUILTIN_TEMPLATES)
TEMPLATES_BY_ID = {t["id"]: t for t in LABEL_TEMPLATES}

_scan_lock = threading.Lock()
_print_lock = threading.Lock()
_templates_lock = threading.Lock()


def derive_cells(page_w, page_h, cols, rows, ml, mt, gx, gy):
    """Symmetric margins: right = left, bottom = top -> derive cell size."""
    cw = (page_w - 2 * ml - (cols - 1) * gx) / cols
    ch = (page_h - 2 * mt - (rows - 1) * gy) / rows
    return cw, ch


def _tnum(v, label):
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ValueError("%s must be a number" % label)


def validate_template(obj):
    """Normalize a submitted sheet (no id/flags) or raise ValueError."""
    name = (obj.get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Name is required")
    cols = int(_tnum(obj.get("cols"), "Columns"))
    rows = int(_tnum(obj.get("rows"), "Rows"))
    if not (1 <= cols <= 50) or not (1 <= rows <= 100):
        raise ValueError("Columns must be 1–50 and rows 1–100")
    if _GRID_NAME.match(name):
        name = "A4 · %d labels (%d×%d)" % (cols * rows, cols, rows)
    page_w = _tnum(obj.get("page_w", PAGE_W), "Page width") or PAGE_W
    page_h = _tnum(obj.get("page_h", PAGE_H), "Page height") or PAGE_H
    ml = _tnum(obj.get("margin_l", 0), "Left margin")
    mt = _tnum(obj.get("margin_t", 0), "Top margin")
    gx = _tnum(obj.get("gap_x", 0), "Column gap")
    gy = _tnum(obj.get("gap_y", 0), "Row gap")
    for v, label in ((ml, "Left margin"), (mt, "Top margin"),
                     (gx, "Column gap"), (gy, "Row gap")):
        if v < 0:
            raise ValueError("%s can't be negative" % label)
    ml, mt, gx, gy = (int(v + 0.5) for v in (ml, mt, gx, gy))   # whole mm, round half up
    cw, ch = derive_cells(page_w, page_h, cols, rows, ml, mt, gx, gy)
    if cw < MIN_CELL_MM or ch < MIN_CELL_MM:
        raise ValueError("Doesn't fit the page — reduce margins, gaps, or counts")
    return {"name": name, "cols": cols, "rows": rows,
            "margin_l": round(ml, 2), "margin_t": round(mt, 2),
            "gap_x": round(gx, 2), "gap_y": round(gy, 2),
            "cell_w": round(cw, 2), "cell_h": round(ch, 2),
            "page_w": page_w, "page_h": page_h}


def _slug(name, taken):
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "sheet"
    tid, i = base, 2
    while tid in taken:
        tid, i = "%s-%d" % (base, i), i + 1
    return tid


def load_all():
    """The full sheet list, seeded from the built-in presets on first run so
    every sheet (presets included) is editable and deletable."""
    if not os.path.exists(TEMPLATES_FILE):
        save_all(BUILTIN_TEMPLATES)
    try:
        with open(TEMPLATES_FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return [dict(t) for t in BUILTIN_TEMPLATES]
    return [_with_defaults(t) for t in (data if isinstance(data, list) else [])
            if isinstance(t, dict) and t.get("id")]


def save_all(items):
    os.makedirs(DATA_DIR, exist_ok=True)
    out = []
    for t in items:
        d = {k: t.get(k) for k in _TEMPLATE_KEYS}
        if t.get("fav"):
            d["fav"] = True
        out.append(d)
    tmp = TEMPLATES_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, TEMPLATES_FILE)


def refresh_templates():
    global LABEL_TEMPLATES, TEMPLATES_BY_ID
    items = load_all()
    for t in items:
        t["builtin"] = t["id"] in BUILTIN_IDS   # informational "Preset" badge only
    LABEL_TEMPLATES = items
    TEMPLATES_BY_ID = {t["id"]: t for t in items}


def upsert_template(obj):
    """Create a sheet, or update the one whose id is sent. Returns the id."""
    with _templates_lock:
        items = load_all()
        norm = validate_template(obj)
        ids = {t["id"] for t in items}
        tid = (obj.get("id") or "").strip()
        if tid and tid in ids:
            norm["id"] = tid
            items = [norm if t["id"] == tid else t for t in items]
        else:
            norm["id"] = _slug(norm["name"], ids | BUILTIN_IDS)
            items.append(norm)
        save_all(items)
        refresh_templates()
        return norm["id"]


def delete_template(tid):
    with _templates_lock:
        save_all([t for t in load_all() if t["id"] != tid])
        refresh_templates()


def set_favorite(tid):
    """Toggle the favorite sheet (the one preselected on load); at most one."""
    with _templates_lock:
        items = load_all()
        was = next((t for t in items if t.get("fav")), None)
        for t in items:
            t.pop("fav", None)
        if not (was and was["id"] == tid):
            for t in items:
                if t["id"] == tid:
                    t["fav"] = True
        save_all(items)
        refresh_templates()


def restore_presets():
    """Re-add any built-in presets that have been deleted."""
    with _templates_lock:
        items = load_all()
        have = {t["id"] for t in items}
        items += [dict(b) for b in BUILTIN_TEMPLATES if b["id"] not in have]
        save_all(items)
        refresh_templates()


refresh_templates()


def sanitize(raw):
    s = SAFE_RE.sub("", raw or "").strip()
    s = re.sub(r"\s+", "-", s)
    return s[:80]


def meta_for(base):
    try:
        with open(os.path.join(META_DIR, base)) as f:
            parts = f.read().strip().split("\t")
            return (parts[0] if parts else ""), (parts[1] if len(parts) > 1 else "")
    except OSError:
        return "", ""


def list_scans(limit=300):
    items = []
    try:
        for name in os.listdir(SCAN_DIR):
            if name.startswith(".") or not name.lower().endswith(".pdf"):
                continue
            path = os.path.join(SCAN_DIR, name)
            if not os.path.isfile(path):
                continue
            st = os.stat(path)
            base = name[:-4]
            dpi, mode = meta_for(base)
            items.append({"name": name, "size": st.st_size, "mtime": int(st.st_mtime),
                          "dpi": dpi, "mode": mode,
                          "thumb": os.path.isfile(os.path.join(THUMB_DIR, base + ".jpg"))})
    except FileNotFoundError:
        pass
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items[:limit]


def ensure_thumb(base):
    """Cached thumbnail path for a scan; render one from the PDF on demand."""
    tp = os.path.join(THUMB_DIR, base + ".jpg")
    if os.path.isfile(tp):
        return tp
    pdf = os.path.join(SCAN_DIR, base + ".pdf")
    if not os.path.isfile(pdf):
        return None
    try:
        os.makedirs(THUMB_DIR, exist_ok=True)
        subprocess.run(["pdftoppm", "-jpeg", "-r", "25", "-singlefile", pdf, tp[:-4]],
                       timeout=40, check=True)
    except Exception:
        return None
    return tp if os.path.isfile(tp) else None


def _rm(*paths):
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


def remove_scan(name):
    if not NAME_RE.fullmatch(name) or not name.lower().endswith(".pdf"):
        return False
    base = name[:-4]
    _rm(os.path.join(SCAN_DIR, name),
        os.path.join(THUMB_DIR, base + ".jpg"),
        os.path.join(META_DIR, base))
    return True


def rename_scan(name, newbase):
    if not NAME_RE.fullmatch(name) or not name.lower().endswith(".pdf"):
        return None, "bad name"
    newbase = sanitize(newbase)
    if not newbase:
        return None, "empty name"
    src = os.path.join(SCAN_DIR, name)
    dst = os.path.join(SCAN_DIR, newbase + ".pdf")
    if not os.path.isfile(src):
        return None, "not found"
    if os.path.exists(dst):
        return None, "a scan with that name already exists"
    ob = name[:-4]
    try:
        os.rename(src, dst)
    except OSError as e:
        return None, str(e)
    for d, ext in ((THUMB_DIR, ".jpg"), (META_DIR, "")):
        try:
            os.rename(os.path.join(d, ob + ext), os.path.join(d, newbase + ext))
        except OSError:
            pass
    return newbase + ".pdf", None


def clear_scans():
    removed = 0
    for s in list_scans(10000):
        if remove_scan(s["name"]):
            removed += 1
    return removed


def run_scan(mode, resolution, name=""):
    if mode not in MODE_VALUES:
        mode = DEF_MODE
    if resolution not in RESOLUTIONS:
        resolution = DEF_RES
    env = dict(os.environ, SCAN_MODE=mode, SCAN_RES=resolution, SCAN_NAME=name)
    with _scan_lock:
        proc = subprocess.run([SCRIPT], env=env, capture_output=True,
                              text=True, timeout=300)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        last = msg.splitlines()[-1] if msg else "scan failed"
        raise RuntimeError(last)
    out = proc.stdout.strip().splitlines()
    return os.path.basename(out[-1]) if out else ""


# --- Label printing ----------------------------------------------------------
def do_print(obj):
    if not PRINT_ENABLED:
        raise RuntimeError("Printing is disabled")
    tpl = TEMPLATES_BY_ID.get(obj.get("template"))
    if not tpl:
        raise RuntimeError("Unknown label sheet")
    n = int(tpl["cols"]) * int(tpl["rows"])

    try:
        scale = float(obj.get("fontScale", 0.9))
    except (TypeError, ValueError):
        scale = 0.9
    scale = min(1.0, max(0.2, scale))
    try:
        cal = (float(obj.get("calX", 0)), float(obj.get("calY", 0)))
    except (TypeError, ValueError):
        cal = (0.0, 0.0)

    raw_cells = obj.get("cells")
    if not isinstance(raw_cells, dict) or not raw_cells:
        raise RuntimeError("Add something to the sheet first")

    total = 0
    tmp = tempfile.mkdtemp(prefix="label-")
    try:
        from reportlab.lib.utils import ImageReader
        cell_content = {}
        for key, cc in raw_cells.items():
            try:
                i = int(key)
            except (TypeError, ValueError):
                continue
            if not (0 <= i < n) or not isinstance(cc, dict):
                continue
            if cc.get("mode") == "file":
                try:
                    data = base64.b64decode(cc.get("dataB64") or "")
                except Exception:
                    raise RuntimeError("Could not read an uploaded image")
                if not data:
                    continue
                total += len(data)
                if total > 40 * 1024 * 1024:
                    raise RuntimeError("Too much image data (max 40 MB total)")
                img_dir = tempfile.mkdtemp(dir=tmp)   # own dir per image (no name clashes)
                img_path = _prepare_image(data, cc.get("filename", ""), img_dir)
                cell_content[i] = {"type": "image", "reader": ImageReader(img_path)}
            elif cc.get("mode") == "qr":
                text = (cc.get("text") or "").strip()
                if not text:
                    continue
                img_dir = tempfile.mkdtemp(dir=tmp)
                cell_content[i] = {"type": "image", "reader": ImageReader(_render_qr_png(text[:512], img_dir))}
            else:
                text = (cc.get("text") or "").strip()
                if text:
                    cell_content[i] = {"type": "text", "text": text[:200]}

        if not cell_content:
            raise RuntimeError("Add something to the sheet first")

        pdf = os.path.join(tmp, "labels.pdf")
        with _print_lock:
            build_label_pdf(tpl, cell_content, cal, scale, pdf)
            job = _submit_lp(pdf)
        return {"queue": PRINT_QUEUE, "job": job, "count": len(cell_content)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _render_qr_png(text, tmp):
    """Render a QR code (from text/URL) to a PNG for reportlab to place in a cell."""
    import qrcode
    qr = qrcode.QRCode(border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(text)
    qr.make(fit=True)
    out = os.path.join(tmp, "qr.png")
    qr.make_image(fill_color="black", back_color="white").save(out)
    return out


def _prepare_image(data, filename, tmp):
    """Return a path to a raster image for reportlab: rasterize a PDF's first
    page, or normalize an image's orientation via Pillow."""
    is_pdf = (filename or "").lower().endswith(".pdf") or data[:5] == b"%PDF-"
    if is_pdf:
        src = os.path.join(tmp, "in.pdf")
        with open(src, "wb") as fh:
            fh.write(data)
        subprocess.run(["pdftoppm", "-png", "-r", "200", "-singlefile",
                        "-f", "1", "-l", "1", src, os.path.join(tmp, "page")],
                       check=True, timeout=90, capture_output=True)
        out = os.path.join(tmp, "page.png")
        if not os.path.isfile(out):
            raise RuntimeError("Could not render the PDF")
        return out
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "RGBA", "L"):
            im = im.convert("RGBA")
        out = os.path.join(tmp, "img.png")
        im.save(out)
        return out
    except Exception:
        raise RuntimeError("Unsupported image file")


def build_label_pdf(tpl, cell_content, cal, font_scale, out_path):
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    pw, ph = 210.0, 297.0
    cols = int(tpl["cols"])
    cw = float(tpl["cell_w"]); ch = float(tpl["cell_h"])
    ml = float(tpl["margin_l"]); mt = float(tpl["margin_t"])
    gx = float(tpl.get("gap_x", 0)); gy = float(tpl.get("gap_y", 0))
    calx, caly = cal
    pad = min(cw, ch) * 0.09  # inner padding, mm
    c = canvas.Canvas(out_path, pagesize=(pw * mm, ph * mm))
    for i, content in cell_content.items():
        r, col = divmod(i, cols)
        xl = ml + col * (cw + gx) + calx
        yt = mt + r * (ch + gy) + caly
        bx = xl * mm
        by = (ph - (yt + ch)) * mm
        bw = cw * mm
        bh = ch * mm
        padpt = pad * mm
        if content["type"] == "text":
            _draw_text(c, content["text"], bx, by, bw, bh, padpt, font_scale)
        else:
            img = content["reader"]
            iw, ih = img.getSize()
            aspect = iw / float(ih or 1)
            bw2 = bw - 2 * padpt
            bh2 = bh - 2 * padpt
            if min(bh2 / aspect, bw2) > min(bw2 / aspect, bh2) * 1.15:  # rotate: clearly larger
                cx = bx + bw / 2.0; cy = by + bh / 2.0
                c.saveState(); c.translate(cx, cy); c.rotate(90)
                c.drawImage(img, -bh2 / 2.0, -bw2 / 2.0, width=bh2, height=bw2,
                            preserveAspectRatio=True, anchor="c", mask="auto")
                c.restoreState()
            else:
                c.drawImage(img, bx + padpt, by + padpt, width=bw2, height=bh2,
                            preserveAspectRatio=True, anchor="c", mask="auto")
    c.showPage()
    c.save()


def _draw_text(c, text, bx, by, bw, bh, pad, scale):
    font = "Helvetica"
    lines = text.split("\n") or [text]
    n = len(lines)
    maxw = max(1.0, bw - 2 * pad)
    maxh = max(1.0, bh - 2 * pad)
    line_gap = 1.18

    def fit(ew, eh):
        # Fit the stacked lines vertically (cap height ~72% of point size), then
        # shrink if the widest line overflows the width.
        size = eh / (0.72 + (n - 1) * line_gap)
        widest = max((c.stringWidth(ln, font, size) for ln in lines), default=0.0)
        if widest > ew and widest > 0:
            size *= ew / widest
        return size

    size_n = fit(maxw, maxh)
    size_r = fit(maxh, maxw)
    rot = size_r > size_n * 1.15   # rotate 90° when it clearly fits larger
    size = max(1.0, (size_r if rot else size_n) * scale)
    c.setFont(font, size)
    c.setFillColorRGB(0, 0, 0)
    leading = size * line_gap
    cx = bx + bw / 2.0
    cy = by + bh / 2.0
    if rot:
        c.saveState()
        c.translate(cx, cy)
        c.rotate(90)
        for i, ln in enumerate(lines):
            c.drawCentredString(0, ((n - 1) / 2.0 - i) * leading - 0.35 * size, ln)
        c.restoreState()
    else:
        for i, ln in enumerate(lines):
            c.drawCentredString(cx, cy + ((n - 1) / 2.0 - i) * leading - 0.35 * size, ln)


def _submit_lp(pdf_path):
    cmd = ["lp", "-d", PRINT_QUEUE, "-o", "media=A4", "-o", "fit-to-page=false", pdf_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "lp failed").strip()
        return_last = msg.splitlines()[-1] if msg else "lp failed"
        raise RuntimeError(return_last)
    m = re.search(r"request id is (\S+)", proc.stdout or "")
    return m.group(1) if m else ""


def mode_options(default):
    return "".join('<option value="%s"%s>%s</option>'
                   % (html.escape(v), " selected" if v == default else "", html.escape(lbl))
                   for v, lbl in MODES)


def res_options(default):
    return "".join('<option value="%s"%s>%s dpi</option>'
                   % (v, " selected" if v == default else "", v) for v in RESOLUTIONS)


def _initial_template():
    """The sheet shown first: the favorite, else the first. The dropdown and the
    server-rendered grid both use this so there's no swap on load."""
    return (next((t for t in LABEL_TEMPLATES if t.get("fav")), None)
            or (LABEL_TEMPLATES[0] if LABEL_TEMPLATES else None))


def tpl_options():
    init = _initial_template()
    initid = init["id"] if init else None
    return "".join('<option value="%s"%s>%s</option>'
                   % (html.escape(t["id"]), " selected" if t["id"] == initid else "",
                      html.escape(t["name"])) for t in LABEL_TEMPLATES)


def initial_sheet_svg():
    """Paper + empty grid for the initial sheet, so the frame paints immediately
    on load; the client re-renders it with content."""
    tpl = _initial_template()
    paper = '<rect class="paper" x="0" y="0" width="210" height="297" rx="2"/>'
    if not tpl:
        return paper
    cols = int(tpl["cols"]); rows = int(tpl["rows"])
    cw = float(tpl["cell_w"]); ch = float(tpl["cell_h"])
    ml = float(tpl["margin_l"]); mt = float(tpl["margin_t"])
    gx = float(tpl.get("gap_x", 0)); gy = float(tpl.get("gap_y", 0))
    out = [paper]
    for i in range(cols * rows):
        r, c = divmod(i, cols)
        x = ml + c * (cw + gx); y = mt + r * (ch + gy)
        out.append('<rect class="cell" x="%s" y="%s" width="%s" height="%s" rx="0.8"/>'
                   % (round(x, 2), round(y, 2), round(cw, 2), round(ch, 2)))
    return "".join(out)


# --- Devices: inventory + Niimbot BLE label printers -------------------------
# The Devices tab unions several sources into one list of
#   {kind, transport, id, name, status, forgettable, detail?, error?}.
# The Niimbot BLE stack lives in a sibling module imported lazily (like
# reportlab/Pillow) so the base app is unaffected when the tab is off.
_scanner_cache = {"t": 0.0, "rows": None}


def _run(cmd, timeout=10):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout or "", p.stderr or ""
    except FileNotFoundError:
        return 127, "", "%s not found" % cmd[0]
    except Exception as e:
        return 1, "", str(e)


def _niimbot():
    """Import the BLE module lazily; raises if bleak isn't installed."""
    import niimbot
    return niimbot


def cups_devices():
    rc, out, err = _run(["lpstat", "-p"])
    if rc != 0 and not out.strip():
        return [{"kind": "printer", "transport": "cups", "id": "", "name": "CUPS",
                 "status": "error", "forgettable": False,
                 "error": (err or "CUPS unavailable").strip()[:120]}]
    uri = {}
    _, vout, _ = _run(["lpstat", "-v"])
    for line in vout.splitlines():
        m = re.match(r"device for (\S+?):\s*(\S+)", line.strip())
        if m:
            uri[m.group(1)] = m.group(2)
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("printer "):
            continue
        name = line.split()[1]
        low = line.lower()
        status = "disconnected" if "disabled" in low else "connected"
        u = uri.get(name, "")
        transport = "usb" if u.startswith("usb") else ("network" if u else "cups")
        rows.append({"kind": "printer", "transport": transport, "id": name, "name": name,
                     "status": status, "forgettable": True, "detail": u[:60]})
    return rows


def _scanner_key(desc):
    """Normalize a SANE description to a per-physical-device key so the direct
    brscan backend and the AirSane eSCL bridge (same USB scanner) collapse to one.
    `ip=...` runs to end of line, so strip it entirely."""
    s = desc.lower()
    s = re.sub(r"ip=.*$", " ", s)
    s = re.sub(r"\bescl\b|\busb scanner\b|\bscanner\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def _scanner_name(desc):
    """A clean model name for display (strip eSCL/USB-scanner/ip= noise + '*')."""
    s = re.sub(r"^eSCL\s+", "", desc)
    s = re.sub(r"\s+ip=\S.*$", "", s)
    s = re.sub(r"\s+USB scanner$", "", s)
    return s.replace("*", "").strip() or desc


def sane_devices(force=False):
    now = time.time()
    if not force and _scanner_cache["rows"] is not None and now - _scanner_cache["t"] < 300:
        return _scanner_cache["rows"]
    rc, out, err = _run(["scanimage", "-L"], timeout=25)
    if rc != 0 and not out.strip():
        msg = (err or "scan backend unavailable").strip().splitlines()
        rows = [{"kind": "scanner", "transport": "usb", "id": "", "name": "Scanners",
                 "status": "error", "forgettable": False,
                 "error": (msg[-1] if msg else "unavailable")[:120]}]
    else:
        by_key, order = {}, []
        for line in out.splitlines():
            m = re.match(r"device `([^']+)' is a (.+)", line.strip())
            if not m:
                continue
            dev_id, desc = m.group(1), m.group(2).strip()
            key = _scanner_key(desc)
            row = {"kind": "scanner", "transport": "usb", "id": dev_id,
                   "name": _scanner_name(desc), "status": "connected",
                   "forgettable": False, "detail": dev_id[:60]}
            if key not in by_key:
                by_key[key] = row
                order.append(key)
            elif by_key[key]["id"].startswith("airscan:") and not dev_id.startswith("airscan:"):
                by_key[key] = row   # same scanner: prefer the direct USB backend over the eSCL bridge
        rows = [by_key[k] for k in order]
        if not rows:
            rows = [{"kind": "scanner", "transport": "usb", "id": "",
                     "name": "No scanners detected", "status": "disconnected",
                     "forgettable": False}]
    _scanner_cache.update(t=now, rows=rows)
    return rows


def usb_devices(seen_names):
    rc, out, err = _run(["lsusb"])
    if rc != 0:
        return [{"kind": "usb", "transport": "usb", "id": "", "name": "USB",
                 "status": "error", "forgettable": False,
                 "error": (err or "lsusb unavailable").strip()[:120]}]
    # Skip devices already represented by a CUPS/SANE row (dedupe on brand token).
    brands = " ".join(seen_names).lower()
    rows = []
    for line in out.splitlines():
        m = re.match(r"Bus \S+ Device \S+: ID (\w+:\w+)\s?(.*)", line.strip())
        if not m:
            continue
        vidpid, name = m.group(1), (m.group(2) or m.group(1)).strip()
        low = name.lower()
        if "root hub" in low:
            continue
        first = low.split()[0] if low.split() else ""
        if first and len(first) > 2 and first in brands:
            continue  # already shown as a printer/scanner
        rows.append({"kind": "usb", "transport": "usb", "id": vidpid, "name": name,
                     "status": "connected", "forgettable": False, "detail": vidpid})
    return rows


def niimbot_rows():
    if not DEVICES_ENABLED:
        return []
    try:
        nb = _niimbot()
    except Exception as e:
        return [{"kind": "label-printer", "transport": "bluetooth", "id": "",
                 "name": "Niimbot (Bluetooth)", "status": "error", "forgettable": False,
                 "error": ("BLE support unavailable: %s" % e)[:120]}]
    rows = []
    for p in nb.manager.state():
        rows.append({"kind": "label-printer", "transport": "bluetooth", "id": p["address"],
                     "name": p["name"], "status": p["status"], "forgettable": True,
                     "detail": p["model_label"]})
    return rows


def inventory(force=False):
    # Niimbot label printers are NOT included here — they have their own managed
    # section (fed by /niimbot/state) so they aren't listed twice.
    rows = []
    rows += cups_devices()
    rows += sane_devices(force)
    rows += usb_devices([r["name"] for r in rows if r.get("id")])
    return rows


def _build_test_pdf(queue, out):
    """A simple A4 test page: title, queue name, timestamp, paper size, and a
    full-page border with corner ticks so alignment/coverage is easy to eyeball."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    import datetime
    pw, ph = 210.0, 297.0
    c = canvas.Canvas(out, pagesize=(pw * mm, ph * mm))
    c.setLineWidth(1)
    c.rect(8 * mm, 8 * mm, (pw - 16) * mm, (ph - 16) * mm)
    for cx, cy in ((8, 8), (pw - 8, 8), (8, ph - 8), (pw - 8, ph - 8)):
        c.line((cx - 5) * mm, cy * mm, (cx + 5) * mm, cy * mm)
        c.line(cx * mm, (cy - 5) * mm, cx * mm, (cy + 5) * mm)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(pw / 2 * mm, (ph / 2 + 12) * mm, "TEST PAGE")
    c.setFont("Helvetica", 12)
    c.drawCentredString(pw / 2 * mm, (ph / 2) * mm, queue)
    c.drawCentredString(pw / 2 * mm, (ph / 2 - 7) * mm, datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    c.drawCentredString(pw / 2 * mm, (ph / 2 - 14) * mm, "A4 · 210 x 297 mm")
    c.showPage()
    c.save()


def print_test_page(kind, dev_id):
    """Print a device-appropriate test page: an A4 sheet to a CUPS queue, or a
    small test label to a Niimbot (sized to its loaded roll)."""
    if kind == "printer" and dev_id:
        tmp = tempfile.mkdtemp(prefix="testpage-")
        try:
            pdf = os.path.join(tmp, "test.pdf")
            _build_test_pdf(dev_id, pdf)
            proc = subprocess.run(["lp", "-d", dev_id, "-o", "media=A4", pdf],
                                  capture_output=True, text=True, timeout=60)
            if proc.returncode != 0:
                raise RuntimeError((proc.stderr or proc.stdout or "lp failed").strip().splitlines()[-1])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return
    if kind == "label-printer" and dev_id:
        _niimbot().manager.sync_print("text", "TEST", dev_id)
        return
    raise RuntimeError("Can't print a test page for this device")


def forget_device(kind, dev_id):
    if kind == "printer" and dev_id:
        rc, out, err = _run(["lpadmin", "-x", dev_id])
        if rc != 0:
            raise RuntimeError((err or out or "could not remove queue").strip().splitlines()[-1])
        return
    if kind == "label-printer" and dev_id:
        _niimbot().manager.sync_forget(dev_id)
        return
    raise RuntimeError("This device can't be removed")


def niimbot_state(with_adapter=True):
    nb = _niimbot()
    return {"enabled": True,
            "adapter": nb.manager.sync_adapter_ok() if with_adapter else True,
            "printers": nb.manager.state(), "active": nb.manager.active,
            "log": nb.manager.recent_log()[-200:]}


class Handler(BaseHTTPRequestHandler):
    server_version = "scan-web/3"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    def _form(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        return urllib.parse.parse_qs(raw)

    def _json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def _devices_post(self, path):
        if not DEVICES_ENABLED:
            return self._json(200, {"ok": False, "error": "Devices are disabled"})
        obj = self._json_body()
        try:
            if path == "/devices/refresh":
                return self._json(200, {"ok": True, "devices": inventory(force=True)})
            if path == "/devices/forget":
                forget_device(obj.get("kind", ""), obj.get("id", ""))
                return self._json(200, {"ok": True, "devices": inventory(force=True)})
            if path == "/devices/testpage":
                print_test_page(obj.get("kind", ""), obj.get("id", ""))
                return self._json(200, {"ok": True})
            nb = _niimbot()
            if path == "/niimbot/scan":
                return self._json(200, {"ok": True, "candidates": nb.manager.sync_scan()})
            if path == "/niimbot/connect":
                nb.manager.sync_connect(obj.get("address", ""), obj.get("name"))
            elif path == "/niimbot/reconnect":
                nb.manager.sync_reconnect(obj.get("address", ""))
            elif path == "/niimbot/disconnect":
                nb.manager.sync_disconnect(obj.get("address", ""))
            elif path == "/niimbot/clearlog":
                nb.manager.clear_log(obj.get("address"))
            elif path == "/niimbot/select":
                nb.manager.select(obj.get("address", ""))
            elif path == "/niimbot/labelsize":
                nb.manager.set_label_mm(obj.get("address", ""), obj.get("w"), obj.get("h"))
            elif path == "/niimbot/print":
                kind = obj.get("kind", "text")
                if kind == "image":
                    payload = base64.b64decode(obj.get("dataB64") or "")
                    if not payload:
                        raise RuntimeError("No image data")
                    if len(payload) > 20 * 1024 * 1024:
                        raise RuntimeError("Image too large (max 20 MB)")
                else:
                    payload = (obj.get("text") or "").strip()
                    if not payload:
                        raise RuntimeError("Nothing to print")
                res = nb.manager.sync_print(kind, payload, obj.get("address"))
                return self._json(200, dict(res, ok=True))
            else:
                return self._json(404, {"ok": False, "error": "Unknown action"})
            return self._json(200, dict(niimbot_state(with_adapter=False), ok=True))
        except Exception as e:
            return self._json(200, {"ok": False, "error": str(e)})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html", "/scan", "/print"):
            self._send(200, render_page(path))
        elif path == "/recent":
            self._json(200, {"scans": list_scans()})
        elif path == "/devices/list":
            self._json(200, {"devices": inventory()})
        elif path == "/niimbot/state":
            try:
                self._json(200, dict(niimbot_state(), ok=True))
            except Exception as e:
                self._json(200, {"ok": False, "enabled": DEVICES_ENABLED, "error": str(e),
                                 "printers": [], "active": None, "adapter": False})
        elif path == "/templates":
            self._json(200, {"templates": LABEL_TEMPLATES})
        elif path.startswith("/file/"):
            self._serve_pdf(urllib.parse.unquote(path[len("/file/"):]))
        elif path.startswith("/thumb/"):
            self._serve_thumb(urllib.parse.unquote(path[len("/thumb/"):]))
        else:
            self._send(404, "Not found", "text/plain")

    def _serve_pdf(self, name):
        if not NAME_RE.fullmatch(name):
            return self._send(400, "Bad name", "text/plain")
        path = os.path.join(SCAN_DIR, name)
        if not os.path.isfile(path):
            return self._send(404, "Not found", "text/plain")
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, "application/pdf",
                   {"Content-Disposition": 'inline; filename="%s"' % name})

    def _serve_thumb(self, name):
        if not NAME_RE.fullmatch(name) or not name.lower().endswith(".pdf"):
            return self._send(400, "Bad name", "text/plain")
        tp = ensure_thumb(name[:-4])
        if not tp:
            return self._send(404, "No thumbnail", "text/plain")
        with open(tp, "rb") as f:
            data = f.read()
        self._send(200, data, "image/jpeg", {"Cache-Control": "max-age=86400"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/devices/") or path.startswith("/niimbot/"):
            return self._devices_post(path)
        if path == "/clear":
            return self._json(200, {"ok": True, "removed": clear_scans()})
        if path == "/remove":
            name = self._form().get("name", [""])[0]
            return self._json(200, {"ok": remove_scan(name)})
        if path == "/rename":
            f = self._form()
            new, err = rename_scan(f.get("name", [""])[0], f.get("to", [""])[0])
            return self._json(200, {"ok": bool(new), "file": new, "error": err})
        if path == "/templates":
            try:
                tid = upsert_template(self._json_body())
                return self._json(200, {"ok": True, "id": tid, "templates": LABEL_TEMPLATES})
            except ValueError as e:
                return self._json(200, {"ok": False, "error": str(e)})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        if path == "/templates/delete":
            tid = (self._json_body() or {}).get("id", "")
            try:
                delete_template(tid)
                return self._json(200, {"ok": True, "templates": LABEL_TEMPLATES})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        if path == "/templates/restore":
            try:
                restore_presets()
                return self._json(200, {"ok": True, "templates": LABEL_TEMPLATES})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        if path == "/templates/favorite":
            tid = (self._json_body() or {}).get("id", "")
            try:
                set_favorite(tid)
                return self._json(200, {"ok": True, "templates": LABEL_TEMPLATES})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        if path == "/print":
            obj = self._json_body()
            try:
                res = do_print(obj)
                return self._json(200, dict(res, ok=True))
            except subprocess.TimeoutExpired:
                return self._json(200, {"ok": False, "error": "The printer did not respond in time."})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        if path != "/scan":
            return self._send(404, "Not found", "text/plain")
        f = self._form()
        mode = f.get("mode", [DEF_MODE])[0]
        res = f.get("resolution", [DEF_RES])[0]
        given = sanitize(f.get("name", [""])[0])
        t0 = time.time()
        try:
            fname = run_scan(mode, res, given)
            if not fname:
                raise RuntimeError("No output file was produced")
            self._json(200, {"ok": True, "file": fname,
                             "seconds": round(time.time() - t0, 1)})
        except subprocess.TimeoutExpired:
            self._json(200, {"ok": False,
                             "error": "Scan timed out. Is a page on the glass and the scanner awake?"})
        except Exception as e:
            self._json(200, {"ok": False, "error": str(e)})


def render_page(path="/"):
    tab = "print" if (path == "/print" and PRINT_ENABLED) else "scan"
    return (PAGE
            .replace("__SCAN_ACTIVE__", " active" if tab == "scan" else "")
            .replace("__PRINT_ACTIVE__", " active" if tab == "print" else "")
            .replace("__SCAN_SEL__", "true" if tab == "scan" else "false")
            .replace("__PRINT_SEL__", "true" if tab == "print" else "false")
            .replace("__TITLE__", html.escape(TITLE))
            .replace("__SHARE__", html.escape(SHARE))
            .replace("__MODE_OPTS__", mode_options(DEF_MODE))
            .replace("__RES_OPTS__", res_options(DEF_RES))
            .replace("__PRINT_TEMPLATE_OPTS__", tpl_options())
            .replace("__SHEET_INIT__", initial_sheet_svg())
            .replace("__TEMPLATES_JSON__", json.dumps(LABEL_TEMPLATES))
            .replace("__PRINT_HIDDEN__", "" if PRINT_ENABLED else " hidden")
            .replace("__DEVICES_HIDDEN__", "" if DEVICES_ENABLED else " hidden"))


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__TITLE__</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230f7a63'/><g fill='%23ffffff'><rect x='7.5' y='7.5' width='7' height='7' rx='1.6'/><rect x='17.5' y='7.5' width='7' height='7' rx='1.6'/><rect x='7.5' y='17.5' width='7' height='7' rx='1.6'/><rect x='17.5' y='17.5' width='7' height='7' rx='1.6'/></g></svg>">
<meta name="theme-color" content="#0f7a63">
<style>
:root{
  --bg:#fbfbf9; --surface:#ffffff; --border:#e7e6e1; --text:#1b1b18;
  --muted:#6f6e67; --faint:#9c9b92; --accent:#0f7a63; --accent-weak:#e8f3ef;
  --primary:#1b1b18; --primary-ink:#ffffff; --danger:#b03a2c;
  --shadow:0 1px 2px rgba(20,20,16,.05),0 8px 24px -14px rgba(20,20,16,.2);
  --pop:0 8px 30px -8px rgba(20,20,16,.35);
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#151518; --surface:#1e1e22; --border:#2e2e34; --text:#eceae6;
    --muted:#9d9c96; --faint:#6d6c66; --accent:#43c3a4; --accent-weak:#16302a;
    --primary:#eceae6; --primary-ink:#151518; --danger:#e2745f;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -16px rgba(0,0,0,.6);
    --pop:0 10px 34px -6px rgba(0,0,0,.7);
  }
}
*{box-sizing:border-box}
[hidden]{display:none!important} /* class display rules must not defeat the attribute */
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);
  line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:640px;margin:0 auto;padding:clamp(22px,5vw,44px) 20px 96px}
header.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
.brand{font-weight:640;font-size:19px;letter-spacing:-.01em}
.brand small{display:block;margin-top:3px;font:500 12px/1.4 var(--mono);color:var(--faint);letter-spacing:.01em}
.status{flex:none;display:inline-flex;align-items:center;gap:7px;font:500 12px/1 var(--mono);color:var(--muted);padding-top:4px}
.status .led{width:7px;height:7px;border-radius:50%;background:var(--accent)}
.status[data-state="busy"] .led{animation:pulse 1.2s ease-in-out infinite}
.status[data-state="error"] .led{background:var(--danger)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.tabs{display:inline-flex;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:4px;box-shadow:var(--shadow);margin-bottom:24px}
.tab-btn{border:none;background:none;padding:8px 18px;border-radius:9px;font:640 13.5px var(--sans);letter-spacing:-.01em;color:var(--muted);cursor:pointer;transition:color .15s,background .15s}
.tab-btn[aria-selected="true"]{background:var(--accent-weak);color:var(--accent)}
.tab-btn:hover{color:var(--text)}
.tab-btn[aria-selected="true"]:hover{color:var(--accent)}
.tab-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tab-panel{display:none}
.tab-panel.active{display:block}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);padding:20px}
.controls{display:flex;gap:12px;margin-bottom:14px}
.field{flex:1;display:flex;flex-direction:column;gap:6px}
.field .lbl{font:600 11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.lbl .opt{text-transform:none;letter-spacing:0;color:var(--faint);font-weight:500}
select,.txt{width:100%;padding:10px 12px;font:500 14px var(--sans);color:var(--text);
  background:var(--bg);border:1px solid var(--border);border-radius:10px}
select{appearance:none;-webkit-appearance:none;padding-right:34px;cursor:pointer;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%239c9b92' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat:no-repeat;background-position:right 12px center}
.namefield{margin-bottom:16px}
select:focus-visible,.txt:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-color:var(--accent)}
.txt::placeholder{color:var(--faint)}
textarea.txt{min-height:74px;line-height:1.4;resize:vertical;display:block}
/* Reserve equal height for both content panes so toggling Text <-> Image/PDF
   doesn't shift the Print button. */
#textPane,#filePane{min-height:96px}
.scan{width:100%;padding:15px 20px;border:none;border-radius:11px;background:var(--primary);
  color:var(--primary-ink);font:640 16px var(--sans);letter-spacing:-.01em;cursor:pointer;transition:opacity .15s,transform .05s}
.scan:hover{opacity:.9}.scan:active{transform:translateY(1px)}.scan:disabled{opacity:.5;cursor:default}
.scan:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.progress{height:2px;margin-top:12px;border-radius:2px;background:var(--border);overflow:hidden;opacity:0;transition:opacity .2s}
.scanning .progress{opacity:1}
.progress .bar{height:100%;width:34%;border-radius:2px;background:var(--accent);transform:translateX(-120%);animation:indet 1.15s ease-in-out infinite}
@keyframes indet{0%{transform:translateX(-120%)}100%{transform:translateX(380%)}}
.note{margin:14px 2px 0;min-height:18px;font:500 13px var(--mono);color:var(--muted)}
.note.ok{color:var(--accent)}.note.err{color:var(--danger)}
.note a{color:inherit}
.recent{margin-top:36px}
.recentHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.recent h2{margin:0 0 2px;font-size:13px;font-weight:640;letter-spacing:.02em}
.recent .path{font:500 12px var(--mono);color:var(--faint);word-break:break-all}
.recent .path a{color:var(--accent);text-decoration:none}
.recent .path a:hover{text-decoration:underline}
.clear{border:none;background:none;cursor:pointer;padding:2px 4px;border-radius:6px;font:600 12px var(--mono);color:var(--faint);letter-spacing:.02em}
.clear:hover{color:var(--danger)}
.clear:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.clear.armed{color:#fff;background:var(--danger)}
.tablewrap{margin-top:14px;overflow-x:auto}
table.scans{width:100%;border-collapse:collapse;font-size:13px}
table.scans th{text-align:left;font:600 11px var(--mono);letter-spacing:.04em;text-transform:uppercase;
  color:var(--faint);padding:0 10px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
table.scans td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
table.scans tr.new td{animation:in .35s ease both}
@keyframes in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.thumb{width:34px;height:44px;object-fit:cover;border-radius:3px;border:1px solid var(--border);
  background:var(--bg);display:block;cursor:zoom-in}
.th-thumb{width:36px}
.fname{font:500 13px var(--mono);word-break:break-all}
.fname .edit{width:100%;min-width:160px;padding:4px 6px;font:500 13px var(--mono);
  color:var(--text);background:var(--bg);border:1px solid var(--accent);border-radius:6px}
.dpi,.size,.when{font:500 12px var(--mono);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.when{color:var(--faint)}
.acts{display:flex;gap:2px;justify-content:flex-end;white-space:nowrap}
.act{border:none;background:none;cursor:pointer;color:var(--muted);padding:5px;border-radius:6px;line-height:0;text-decoration:none}
.act:hover{color:var(--text);background:var(--bg)}
.act:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.act.remove.armed{color:#fff;background:var(--danger)}
.empty{padding:16px 2px;color:var(--muted);font-size:14px}
.preview{position:fixed;z-index:50;pointer-events:none;background:var(--surface);
  border:1px solid var(--border);border-radius:8px;box-shadow:var(--pop);padding:4px}
.preview img{display:block;width:300px;height:auto;border-radius:5px}
/* --- Print / labels --- */
.sheetHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:2px 0 10px}
.sheetHead .lbl{font:600 11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.sheetActs{display:flex;gap:4px;flex:none}
.mini{border:none;background:var(--bg);cursor:pointer;padding:4px 10px;border-radius:7px;font:600 11px var(--mono);letter-spacing:.03em;color:var(--muted)}
.mini:hover{color:var(--text)}
.mini:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.sheet-wrap{display:flex;justify-content:center;margin-bottom:18px}
svg.sheet{width:100%;max-width:330px;height:auto;border-radius:6px;touch-action:manipulation}
.sheet .paper{fill:var(--bg);stroke:var(--border);stroke-width:.5}
.sheet .cell{fill:transparent;stroke:var(--border);stroke-width:.35;cursor:pointer;transition:fill .1s}
.sheet .cell:hover{fill:var(--accent-weak)}
.sheet .cell.sel{fill:var(--accent-weak)}
.sheet .seloutline{fill:none;stroke:var(--accent);stroke-width:.7;pointer-events:none}
.sheet .cell.filled{fill:var(--accent-weak);fill-opacity:.4}
.buildacts{display:flex;gap:10px;margin-top:4px}
.buildacts .scan{flex:1}
.buildacts .btn2{flex:none}
.pdiv{border:none;border-top:1px solid var(--border);margin:18px 0}
.sheet .ptext{fill:var(--accent);font-family:var(--sans);font-weight:700;text-anchor:middle;dominant-baseline:central;pointer-events:none}
.sheet image{pointer-events:none} /* let clicks fall through to the cell rect so it stays toggleable */
/* sheet management */
.tplrow{align-items:flex-end}
.manage{flex:none;height:40px;padding:0 14px;white-space:nowrap}
.modal{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;background:rgba(20,20,16,.44)}
@media (prefers-color-scheme:dark){.modal{background:rgba(0,0,0,.6)}}
.modal-card{width:100%;max-width:460px;margin:auto}
.modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.modal-head strong{font-size:15px;font-weight:640;letter-spacing:-.01em}
.mclose{border:none;background:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;padding:0 4px;border-radius:6px}
.mclose:hover{color:var(--text)}
.mclose:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sheetlist{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.srow{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.srow .info{flex:1;min-width:0}
.srow .nm{font-weight:600;font-size:13.5px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.srow .sub{font:500 11.5px var(--mono);color:var(--faint);margin-top:3px}
.badge{font:600 9.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-weak);padding:2px 6px;border-radius:5px}
.badge.ed{color:var(--muted);background:var(--bg)}
.srow .ra{display:flex;gap:2px;flex:none}
.act.star.on{color:#e0a800}
.act.star:hover{color:#e0a800}
.scan.alt{background:var(--surface);color:var(--text);border:1px dashed var(--border)}
.scan.alt:hover{opacity:1;border-color:var(--accent);color:var(--accent)}
.editacts{display:flex;align-items:stretch;gap:10px;margin-top:18px}
.editacts .scan{flex:1;padding:14px 20px}
.btn2{flex:none;padding:0 22px;border:1px solid var(--border);border-radius:11px;background:var(--surface);color:var(--text);font:640 15px var(--sans);letter-spacing:-.01em;cursor:pointer;transition:border-color .15s,color .15s}
.btn2:hover{border-color:var(--accent);color:var(--accent)}
.btn2:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.act.del.armed{color:#fff;background:var(--danger)}
.linkbtn{display:block;width:100%;margin-top:12px;border:none;background:none;cursor:pointer;font:600 12.5px var(--mono);letter-spacing:.02em;padding:9px;border-radius:9px}
.linkbtn.del{color:var(--danger)}
.linkbtn.del.armed{color:#fff;background:var(--danger)}
.linkbtn.armed{color:#fff;background:var(--danger)}
.linkbtn.subtle{color:var(--faint)}
.linkbtn.subtle:hover{color:var(--muted)}
.linkbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cellcap{margin:10px 2px 0;min-height:16px;font:500 12px var(--mono);color:var(--muted)}
.cellcap.err{color:var(--danger)}
.hint{margin-top:10px;font:500 11.5px var(--mono);color:var(--faint)}
.schematic{max-width:280px}
.schematic .mband{fill:var(--accent-weak)}
.schematic .cell{fill:transparent;stroke:var(--border);stroke-width:.4;pointer-events:none}
.schematic .hlband{fill:var(--danger);fill-opacity:.2}
.schematic .cell.hl{fill:var(--danger);fill-opacity:.14;stroke:var(--danger);stroke-width:.6}
.schematic .hlgap{fill:var(--danger);fill-opacity:.32}
.schematic .dim{fill:var(--muted);font-family:var(--mono);font-weight:600;text-anchor:middle}
.seg{display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:3px;margin-bottom:14px}
.seg-btn{border:none;background:none;padding:6px 14px;border-radius:7px;font:600 12.5px var(--sans);color:var(--muted);cursor:pointer}
.seg-btn[aria-selected="true"]{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.seg-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.filein{width:100%;font:500 13px var(--sans);color:var(--muted)}
.filein::file-selector-button{font:600 12px var(--sans);color:var(--text);background:var(--bg);
  border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-right:10px;cursor:pointer}
.chip{display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:6px 8px 6px 12px;
  background:var(--accent-weak);border-radius:8px;font:500 12px var(--mono);color:var(--accent);max-width:100%}
.chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip button{border:none;background:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:0 2px}
.filepv{display:block;max-width:120px;max-height:120px;margin-top:12px;border-radius:6px;border:1px solid var(--border)}
.adv{margin:6px 0 16px}
.adv summary{cursor:pointer;font:600 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--faint);padding:8px 0;list-style:none}
.adv summary::-webkit-details-marker{display:none}
.adv summary:hover{color:var(--muted)}
.adv[open] summary{color:var(--muted);margin-bottom:8px}
.adv .controls{margin-bottom:2px}
input[type=range]{accent-color:var(--accent);width:100%;margin-top:8px}
input[type=number]{font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;animation-iteration-count:1!important}.progress .bar{width:100%;transform:none}}
@media (max-width:560px){.th-when,.when{display:none}.preview img{width:220px}}
/* --- Devices --- */
.devlist,.candlist{display:flex;flex-direction:column;gap:8px}
.candlist:not(:empty){margin-top:8px}
.drow{display:flex;align-items:center;gap:11px;padding:10px 12px;min-height:56px;border:1px solid var(--border);border-radius:11px}
.drow .dinfo{flex:1;min-width:0}
.drow .dname{font-weight:600;font-size:13.5px;letter-spacing:-.01em;display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drow .dsub{font:500 11.5px var(--mono);color:var(--faint);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drow .dacts{display:flex;gap:5px;flex:none;align-items:center}
.ifi{display:inline-flex;flex:none;color:var(--muted)}
.ifi svg{width:15px;height:15px}
.mini.ic{padding:0;width:30px;height:30px;flex:none;display:inline-flex;align-items:center;justify-content:center}
.mini.ic svg{width:16px;height:16px}
.mini.ic.pri{background:var(--accent-weak);color:var(--accent)}
.mini.ic.on{color:var(--accent);background:var(--accent-weak)}
.mini.ic.warn:hover{color:var(--danger)}
.mini.ic.armed{background:var(--danger);color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}
.dot.on{background:var(--accent)}
.dot.err{background:var(--danger)}
.kind{font:600 9.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:var(--bg);padding:2px 6px;border-radius:5px}
.derr{color:var(--danger)}
.mini.danger:hover{color:var(--danger)}
.mini.armed{color:#fff;background:var(--danger)}
.mini.pri{background:var(--accent-weak);color:var(--accent)}
.drow.active{border-color:var(--accent);background:var(--accent-weak)}
.blelog{margin:0;max-height:180px;overflow:auto;background:var(--bg);border:1px solid var(--border);
  border-radius:8px;padding:8px 10px;font:500 11px/1.5 var(--mono);color:var(--muted);white-space:pre-wrap;word-break:break-all}
.headright{display:flex;align-items:center;gap:12px;flex:none}
.iconbtn{position:relative;border:1px solid var(--border);background:var(--surface);border-radius:10px;
  width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  color:var(--muted);box-shadow:var(--shadow);transition:color .15s,border-color .15s}
.iconbtn:hover{color:var(--text);border-color:var(--accent)}
.iconbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.iconbtn .badge-dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;
  background:var(--danger);border:2px solid var(--surface);display:none}
.iconbtn.alert .badge-dot{display:block}
.deverr{margin:2px 0 12px;font:500 12px var(--mono);color:var(--danger);min-height:0}
.modal-card.wide{max-width:520px}
.msub{font:600 11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:18px 2px 10px}
.iconbtn.sm{width:30px;height:30px;border-radius:8px}
.iconbtn.spin svg{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.grp{font:600 10.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:16px 2px 8px}
.grp:first-child{margin-top:2px}
.iface{font:600 9.5px var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--bg);border:1px solid var(--border);padding:1px 6px;border-radius:5px}
#invGroups .drow{margin-bottom:9px}
.loghead{display:flex;align-items:center;gap:12px;margin:2px 0 12px}
.loghead strong{font-size:14px;font-weight:640;letter-spacing:-.01em}
.logacts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
#devLog{max-height:340px;min-height:120px}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">__TITLE__</div>
    <div class="headright">
      <span class="status" id="status" data-state="idle" role="status" aria-live="polite">
        <i class="led"></i><span id="statusText">Ready</span>
      </span>
      <button class="iconbtn" id="devicesBtn" title="Devices" aria-label="Manage devices"__DEVICES_HIDDEN__>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span class="badge-dot"></span>
      </button>
    </div>
  </header>

  <nav class="tabs" role="tablist" aria-label="Tools">
    <button class="tab-btn" id="tabScanBtn" data-tab="scan" role="tab" aria-selected="__SCAN_SEL__" aria-controls="tab-scan">Scan</button>
    <button class="tab-btn" id="tabPrintBtn" data-tab="print" role="tab" aria-selected="__PRINT_SEL__" aria-controls="tab-print"__PRINT_HIDDEN__>Print</button>
  </nav>

  <section class="tab-panel__SCAN_ACTIVE__" id="tab-scan" role="tabpanel" aria-labelledby="tabScanBtn">
    <form class="card" id="form">
      <div class="controls" id="scannerSelRow" hidden>
        <label class="field"><span class="lbl">Scanner</span>
          <select id="scannerSel"></select></label>
      </div>
      <div class="controls">
        <label class="field"><span class="lbl">Mode</span>
          <select name="mode" id="mode">__MODE_OPTS__</select></label>
        <label class="field"><span class="lbl">Resolution</span>
          <select name="resolution" id="resolution">__RES_OPTS__</select></label>
      </div>
      <label class="field namefield">
        <span class="lbl">Name <span class="opt">optional</span></span>
        <input class="txt" type="text" name="name" id="name" maxlength="80"
               autocomplete="off" placeholder="auto: scan-YYYYMMDD-HHMMSS">
      </label>
      <button class="scan" id="scanBtn" type="submit">Scan</button>
      <div class="progress" aria-hidden="true"><div class="bar"></div></div>
      <p class="note" id="note" aria-live="polite"></p>
    </form>

    <section class="recent">
      <div class="recentHead">
        <h2>Recent scans</h2>
        <button type="button" class="clear" id="clearBtn">Clear all</button>
      </div>
      <div class="path">Saved to <a href="__SHARE__">__SHARE__</a></div>
      <div class="tablewrap">
        <table class="scans">
          <thead><tr>
            <th class="th-thumb"></th><th>Name</th><th>DPI</th><th>Size</th>
            <th class="th-when">When</th><th></th>
          </tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <p class="empty" id="empty" hidden>No scans yet. Place a page on the glass and press Scan.</p>
    </section>
  </section>

  <section class="tab-panel__PRINT_ACTIVE__" id="tab-print" role="tabpanel" aria-labelledby="tabPrintBtn"__PRINT_HIDDEN__>
    <div class="card">
      <!-- Printer selector: shown only when more than one printer is available -->
      <div class="controls" id="printerSelRow" hidden>
        <label class="field"><span class="lbl">Printer</span>
          <select id="printerSel"></select></label>
      </div>

      <!-- A4 / CUPS sheet composer -->
      <div id="a4Composer">
        <div class="controls tplrow">
          <label class="field"><span class="lbl">Label sheet</span>
            <select id="tpl">__PRINT_TEMPLATE_OPTS__</select></label>
          <button type="button" class="mini manage" id="manageBtn">Manage</button>
        </div>

        <div class="sheetHead">
          <span class="lbl" id="selInfo">Tap cells to place your label</span>
          <span class="sheetActs">
            <button type="button" class="mini" id="selAll">All</button>
            <button type="button" class="mini" id="selNone">None</button>
          </span>
        </div>
        <div class="sheet-wrap"><svg class="sheet" id="sheet" viewBox="0 0 210 297" role="group" aria-label="Label sheet">__SHEET_INIT__</svg></div>

        <div class="seg" role="tablist" aria-label="Content type">
          <button type="button" class="seg-btn" id="segText" role="tab" aria-selected="true">Text</button>
          <button type="button" class="seg-btn" id="segFile" role="tab" aria-selected="false">Image / PDF</button>
          <button type="button" class="seg-btn" id="segQr" role="tab" aria-selected="false">QR</button>
        </div>

        <div id="textPane">
          <label class="field"><span class="lbl">Text <span class="opt">one line per row</span></span>
            <textarea class="txt" id="ptext" rows="2" maxlength="200" autocomplete="off"
                      placeholder="e.g. 42 — or a short&#10;label on two lines"></textarea></label>
        </div>
        <div id="filePane" hidden>
          <label class="field"><span class="lbl">Image or PDF</span>
            <input class="filein" id="pfile" type="file" accept="image/*,application/pdf"></label>
          <div class="chip" id="fileChip" hidden><span id="fileName"></span><button type="button" id="fileClear" aria-label="Remove file">×</button></div>
          <img class="filepv" id="filePv" hidden alt="">
          <div class="hint">Tip: paste an image with ⌘V / Ctrl+V</div>
        </div>
        <div id="qrPane" hidden>
          <label class="field"><span class="lbl">QR text or URL</span>
            <textarea class="txt" id="pqr" rows="2" maxlength="512" autocomplete="off"
                      placeholder="e.g. https://example.com or any text"></textarea></label>
        </div>

        <div class="buildacts">
          <button class="scan" id="addBtn" type="button" disabled>Add to sheet</button>
          <button class="btn2" id="eraseBtn" type="button" hidden>Erase</button>
        </div>

        <hr class="pdiv">

        <button class="scan" id="printBtn" type="button" disabled>Print sheet</button>
        <button class="linkbtn subtle" id="clearSheetBtn" type="button" hidden>Clear sheet</button>
      </div>

      <!-- Niimbot label composer (shown when a Niimbot printer is selected) -->
      <div id="labelComposer" hidden>
        <div class="controls">
          <label class="field"><span class="lbl">Label width <span class="opt">mm</span></span>
            <input class="txt" id="niimW" type="number" min="5" max="120" step="1"></label>
          <label class="field"><span class="lbl">Label length <span class="opt">mm</span></span>
            <input class="txt" id="niimH" type="number" min="5" max="300" step="1"></label>
        </div>

        <div class="seg" role="tablist" aria-label="Label content">
          <button type="button" class="seg-btn" id="nsegText" role="tab" aria-selected="true">Text</button>
          <button type="button" class="seg-btn" id="nsegImg" role="tab" aria-selected="false">Image</button>
          <button type="button" class="seg-btn" id="nsegQr" role="tab" aria-selected="false">QR</button>
        </div>
        <div id="nTextPane">
          <label class="field"><span class="lbl" id="nTextLbl">Text <span class="opt">one line per row</span></span>
            <textarea class="txt" id="nText" rows="2" maxlength="200" autocomplete="off"
                      placeholder="e.g. 42 — or a short&#10;label on two lines"></textarea></label>
        </div>
        <div id="nImgPane" hidden>
          <label class="field"><span class="lbl">Image</span>
            <input class="filein" id="nFile" type="file" accept="image/*"></label>
          <img class="filepv" id="nPv" hidden alt="">
        </div>

        <hr class="pdiv">
        <button class="scan" id="niimPrint" type="button" disabled>Print label</button>
      </div>

      <p class="note" id="pnote" aria-live="polite"></p>
    </div>
  </section>
</div>

<!-- Devices modal (opened from the header gear) -->
<div class="modal" id="devicesModal" hidden>
  <div class="modal-card card wide" role="dialog" aria-modal="true" aria-labelledby="devModalTitle">
    <div class="modal-head">
      <strong id="devModalTitle">Devices</strong>
      <span style="display:flex;gap:6px;align-items:center">
        <button type="button" class="iconbtn sm" id="devRefresh" title="Refresh" aria-label="Refresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
        </button>
        <button type="button" class="mclose" id="devModalClose" aria-label="Close">×</button>
      </span>
    </div>
    <p class="deverr" id="devNote"></p>

    <div id="devMain">
      <div id="invGroups"><p class="empty">Loading…</p></div>

      <div class="msub">Label printers
        <button type="button" class="mini" id="niimScan" style="float:right;text-transform:none;letter-spacing:0">Scan for printers</button>
      </div>
      <p class="hint" id="niimAdapter" hidden>Bluetooth adapter not available on this host.</p>
      <div class="devlist" id="niimList"></div>
      <div class="candlist" id="candList"></div>
    </div>

    <div id="devLogView" hidden>
      <div class="loghead">
        <button type="button" class="mini" id="logBack">← Back</button>
        <strong id="logTitle"></strong>
      </div>
      <pre class="blelog" id="devLog"></pre>
      <div class="logacts">
        <button type="button" class="mini" id="logCopy">Copy</button>
        <button type="button" class="mini danger" id="logClear">Clear</button>
      </div>
    </div>
  </div>
</div>
<div class="modal" id="sheetModal" hidden>
  <div class="modal-card card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head">
      <strong id="modalTitle">Label sheets</strong>
      <button type="button" class="mclose" id="modalClose" aria-label="Close">×</button>
    </div>

    <div id="listView">
      <div class="sheetlist" id="sheetList"></div>
      <button type="button" class="scan alt" id="newSheet">New sheet</button>
      <button type="button" class="linkbtn subtle" id="restoreBtn">Restore default sheets</button>
    </div>

    <div id="editView" hidden>
      <label class="field namefield"><span class="lbl">Name</span>
        <input class="txt" id="eName" maxlength="60" autocomplete="off" placeholder="e.g. My 40-up"></label>
      <div class="controls">
        <label class="field"><span class="lbl">Columns</span>
          <input class="txt" id="eCols" type="number" min="1" max="50" step="1"></label>
        <label class="field"><span class="lbl">Rows</span>
          <input class="txt" id="eRows" type="number" min="1" max="100" step="1"></label>
      </div>
      <div class="controls">
        <label class="field"><span class="lbl">Left margin <span class="opt">mm</span></span>
          <input class="txt" id="eML" type="number" min="0" max="100" step="1"></label>
        <label class="field"><span class="lbl">Top margin <span class="opt">mm</span></span>
          <input class="txt" id="eMT" type="number" min="0" max="140" step="1"></label>
      </div>
      <div class="controls">
        <label class="field"><span class="lbl">Column gap <span class="opt">mm</span></span>
          <input class="txt" id="eGX" type="number" min="0" max="50" step="1"></label>
        <label class="field"><span class="lbl">Row gap <span class="opt">mm</span></span>
          <input class="txt" id="eGY" type="number" min="0" max="50" step="1"></label>
      </div>
      <div class="sheet-wrap"><svg class="sheet schematic" id="eSheet" viewBox="0 0 210 297" role="img" aria-label="Sheet dimensions"></svg></div>
      <p class="cellcap" id="eCap"></p>
      <div class="editacts">
        <button type="button" class="scan" id="eSave">Save sheet</button>
        <button type="button" class="btn2" id="eCancel">Cancel</button>
      </div>
      <button type="button" class="linkbtn del" id="eDelete" hidden>Delete this sheet</button>
    </div>
  </div>
</div>
<div class="preview" id="preview" hidden><img id="previewImg" alt=""></div>

<script>
(function(){
  var form=document.getElementById('form'), btn=document.getElementById('scanBtn');
  var status=document.getElementById('status'), statusText=document.getElementById('statusText');
  var note=document.getElementById('note'), tbody=document.getElementById('tbody');
  var empty=document.getElementById('empty'), preview=document.getElementById('preview'), previewImg=document.getElementById('previewImg');
  var scanning=false;
  var ICON={
    dl:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>',
    rn:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l2 2-7 7-3 1 1-3z"/></svg>',
    rm:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V3h4v1M5 4l1 9h4l1-9"/></svg>',
    dup:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M2.5 10.5V3.5a1 1 0 011-1h7"/></svg>',
    rs:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 11-1.5-3.6"/><path d="M13 2v3h-3"/></svg>',
    star:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.77 4.48 12.9l.67-3.92L2.3 6.14l3.94-.57z"/></svg>',
    starf:'<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.77 4.48 12.9l.67-3.92L2.3 6.14l3.94-.57z"/></svg>'
  };
  function esc(s){return (s+'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function fmtSize(b){ if(b<1024)return b+' B'; if(b<1048576)return (b/1024).toFixed(b<10240?1:0)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
  function ago(sec){ var d=Math.max(0,Math.floor(Date.now()/1000)-sec);
    if(d<60)return 'just now'; if(d<3600)return Math.floor(d/60)+'m ago'; if(d<86400)return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; }
  function setStatus(st,t){ status.dataset.state=st; statusText.textContent=t; }

  // --- tabs ---
  var tabBtns=Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
  function tabHidden(name){ var b=document.querySelector('.tab-btn[data-tab="'+name+'"]'); return !b || b.hidden; }
  function pathTab(){ var p=location.pathname.replace(/\/+$/,'');
    return (p==='/print' && !tabHidden('print')) ? 'print' : 'scan'; }
  function selectTab(name, push){
    tabBtns.forEach(function(x){ x.setAttribute('aria-selected', x.dataset.tab===name?'true':'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'),function(p){
      p.classList.toggle('active', p.id==='tab-'+name); });
    if(push){ try{ history.pushState({tab:name}, '', '/'+name); }catch(e){} }
  }
  tabBtns.forEach(function(b){
    b.addEventListener('click',function(){ if(!b.hidden) selectTab(b.dataset.tab, true); });
  });
  window.addEventListener('popstate',function(){ selectTab(pathTab(), false); });

  function render(scans, newest){
    tbody.innerHTML='';
    empty.hidden = scans.length>0;
    scans.forEach(function(s){
      var enc=encodeURIComponent(s.name);
      var tr=document.createElement('tr');
      tr.className = (s.name===newest?'new':'');
      tr.dataset.name=s.name;
      tr.innerHTML=
        '<td><img class="thumb" loading="lazy" src="/thumb/'+enc+'" alt="" data-src="/thumb/'+enc+'"></td>'+
        '<td><span class="fname">'+esc(s.name)+'</span></td>'+
        '<td class="dpi">'+(s.dpi?esc(s.dpi):'—')+'</td>'+
        '<td class="size">'+fmtSize(s.size)+'</td>'+
        '<td class="when">'+ago(s.mtime)+'</td>'+
        '<td><div class="acts">'+
          '<a class="act" href="/file/'+enc+'" download title="Download" aria-label="Download">'+ICON.dl+'</a>'+
          '<button type="button" class="act" data-act="rename" title="Rename" aria-label="Rename">'+ICON.rn+'</button>'+
          '<button type="button" class="act remove" data-act="remove" title="Remove" aria-label="Remove">'+ICON.rm+'</button>'+
        '</div></td>';
      tbody.appendChild(tr);
    });
  }
  function refresh(newest){
    return fetch('/recent').then(function(r){return r.json();})
      .then(function(d){render(d.scans||[], newest);}).catch(function(){});
  }

  // --- scan ---
  form.addEventListener('submit',function(e){
    e.preventDefault(); if(scanning) return;
    scanning=true; form.classList.add('scanning'); btn.disabled=true; btn.textContent='Scanning…';
    note.className='note'; note.textContent=''; setStatus('busy','Scanning');
    fetch('/scan',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(new FormData(form)).toString()})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.ok){ setStatus('idle','Ready'); note.className='note ok';
          note.innerHTML='Saved '+esc(d.file)+' · '+d.seconds+'s — <a href="/file/'+encodeURIComponent(d.file)+'" target="_blank" rel="noopener">open</a>';
          document.getElementById('name').value=''; return refresh(d.file); }
        setStatus('error','Failed'); note.className='note err'; note.textContent=d.error||'Scan failed.';
      })
      .catch(function(){ setStatus('error','Failed'); note.className='note err'; note.textContent='Could not reach the scanner service.'; })
      .finally(function(){ scanning=false; form.classList.remove('scanning'); btn.disabled=false; btn.textContent='Scan'; });
  });

  // --- row actions (rename / remove) ---
  tbody.addEventListener('click',function(e){
    var b=e.target.closest('[data-act]'); if(!b) return;
    var tr=b.closest('tr'), name=tr.dataset.name;
    if(b.dataset.act==='remove'){
      if(!b.classList.contains('armed')){
        b.classList.add('armed'); b.title='Click again to delete';
        setTimeout(function(){ b.classList.remove('armed'); b.title='Remove'; }, 3000);
        return;
      }
      fetch('/remove',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'name='+encodeURIComponent(name)}).then(function(){ refresh(); });
    } else if(b.dataset.act==='rename'){
      startRename(tr, name);
    }
  });
  function startRename(tr, name){
    var span=tr.querySelector('.fname');
    if(tr.querySelector('.edit')) return;
    var base=name.replace(/\.pdf$/i,'');
    var inp=document.createElement('input');
    inp.className='edit'; inp.type='text'; inp.value=base; inp.maxLength=80;
    span.replaceWith(inp); inp.focus(); inp.select();
    function done(save){
      var to=inp.value.trim();
      if(!save || !to || to===base){ refresh(); return; }
      fetch('/rename',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'name='+encodeURIComponent(name)+'&to='+encodeURIComponent(to)})
        .then(function(r){return r.json();})
        .then(function(d){
          if(!d.ok){ note.className='note err'; note.textContent=d.error||'Rename failed.'; }
          return refresh(d.file);
        }).catch(function(){ refresh(); });
    }
    inp.addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ev.preventDefault();done(true);} else if(ev.key==='Escape'){done(false);} });
    inp.addEventListener('blur',function(){ done(true); });
  }

  // --- hover preview ---
  tbody.addEventListener('mouseover',function(e){
    var img=e.target.closest('.thumb'); if(!img) return;
    previewImg.src=img.dataset.src; preview.hidden=false; movePreview(e);
  });
  tbody.addEventListener('mousemove',function(e){ if(!preview.hidden && e.target.closest('.thumb')) movePreview(e); });
  tbody.addEventListener('mouseout',function(e){ if(e.target.closest('.thumb')) preview.hidden=true; });
  function movePreview(e){
    var pad=16, w=preview.offsetWidth||316, h=preview.offsetHeight||420;
    var x=e.clientX+pad, y=e.clientY+pad;
    if(x+w>window.innerWidth) x=e.clientX-w-pad;
    if(y+h>window.innerHeight) y=Math.max(8, window.innerHeight-h-8);
    preview.style.left=x+'px'; preview.style.top=y+'px';
  }

  // --- clear all ---
  var clearBtn=document.getElementById('clearBtn'), clearTimer=null;
  function disarm(){ clearTimeout(clearTimer); clearBtn.classList.remove('armed'); clearBtn.textContent='Clear all'; }
  clearBtn.addEventListener('click',function(){
    if(scanning) return;
    if(!clearBtn.classList.contains('armed')){ clearBtn.classList.add('armed'); clearBtn.textContent='Click again to delete all'; clearTimer=setTimeout(disarm,4000); return; }
    clearTimeout(clearTimer); clearBtn.classList.remove('armed'); clearBtn.disabled=true; clearBtn.textContent='Clearing…';
    fetch('/clear',{method:'POST'}).then(function(r){return r.json();})
      .then(function(d){ note.className='note'; note.textContent=d.removed?('Removed '+d.removed+' scan'+(d.removed===1?'':'s')+'.'):'Nothing to remove.'; return refresh(); })
      .catch(function(){ note.className='note err'; note.textContent='Could not clear the scans.'; })
      .finally(function(){ clearBtn.disabled=false; clearBtn.textContent='Clear all'; });
  });

  // --- print / labels ---
  var TEMPLATES=__TEMPLATES_JSON__, TBYID={};
  TEMPLATES.forEach(function(t){ TBYID[t.id]=t; });
  var tplSel=document.getElementById('tpl'), sheet=document.getElementById('sheet');
  var selInfo=document.getElementById('selInfo'), printBtn=document.getElementById('printBtn'), pnote=document.getElementById('pnote');
  var addBtn=document.getElementById('addBtn'), eraseBtn=document.getElementById('eraseBtn'), clearSheetBtn=document.getElementById('clearSheetBtn');
  var ptext=document.getElementById('ptext');
  var segText=document.getElementById('segText'), segFile=document.getElementById('segFile'), segQr=document.getElementById('segQr');
  var textPane=document.getElementById('textPane'), filePane=document.getElementById('filePane'), qrPane=document.getElementById('qrPane'), pqr=document.getElementById('pqr');
  var pfile=document.getElementById('pfile'), fileChip=document.getElementById('fileChip');
  var fileNameEl=document.getElementById('fileName'), fileClear=document.getElementById('fileClear'), filePv=document.getElementById('filePv');
  var sel=new Set(), cellContent={}, pmode='text', fileData=null, fileNm='', filePvUrl=null, fileAspect=1, printing=false;

  function f2(n){ return Math.round(n*100)/100; }
  function makeThumb(dataUrl, cb){
    var img=new Image();
    img.onload=function(){
      var w=img.width||1, h=img.height||1, max=200, s=Math.min(1, max/Math.max(w,h));
      var cv=document.createElement('canvas');
      cv.width=Math.max(1,Math.round(w*s)); cv.height=Math.max(1,Math.round(h*s));
      try{ cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); cb(cv.toDataURL('image/png'), w/h); }
      catch(e){ cb(dataUrl, w/h); }
    };
    img.onerror=function(){ cb(null, 1); };
    img.src=dataUrl;
  }
  // Rotate content 90° when the rotated fit is clearly larger (tall/narrow cell).
  function textFit(EW, EH, maxlen, nl, lg){ return Math.min(EH*0.6, (EW*0.82)/(maxlen*0.58), (EH*0.82)/(0.72+(nl-1)*lg)); }
  function imgFit(W, H, aspect){ return Math.min(W/aspect, H); }
  function curTpl(){ return TBYID[tplSel.value] || TEMPLATES[0]; }
  function pendingContent(){   // the content currently in the panel (or null)
    if(pmode==='text'){ var v=ptext.value; return v.trim()?{mode:'text',text:v}:null; }
    if(pmode==='qr'){ var q=pqr.value; return q.trim()?{mode:'qr',text:q.trim()}:null; }
    return fileData?{mode:'image',dataB64:fileData,filename:fileNm,aspect:fileAspect,thumbUrl:filePvUrl}:null;
  }
  function filledCount(){ return Object.keys(cellContent).length; }
  // Draw one cell's content (text or image), auto-rotating when it fits larger.
  function drawCellContent(content, x, y, cw, ch){
    var cx=x+cw/2, cy=y+ch/2, ip=Math.min(cw,ch)*0.08, s='', lg=1.18;
    if(content.mode==='image' && content.thumbUrl){
      var asp=content.aspect||1, iRot=imgFit(ch,cw,asp)>imgFit(cw,ch,asp)*1.15;
      if(iRot) s+='<g transform="rotate(-90 '+f2(cx)+' '+f2(cy)+')"><image href="'+content.thumbUrl+'" x="'+f2(cx-ch/2+ip)+'" y="'+f2(cy-cw/2+ip)+'" width="'+f2(ch-2*ip)+'" height="'+f2(cw-2*ip)+'" preserveAspectRatio="xMidYMid meet"/></g>';
      else s+='<image href="'+content.thumbUrl+'" x="'+f2(x+ip)+'" y="'+f2(y+ip)+'" width="'+f2(cw-2*ip)+'" height="'+f2(ch-2*ip)+'" preserveAspectRatio="xMidYMid meet"/>';
    } else if(content.mode==='text'){
      var txt=(content.text||'').trim(); if(!txt) return '';
      var lines=txt.split('\n'), nl=lines.length, maxlen=1;
      for(var k=0;k<nl;k++){ if(lines[k].length>maxlen) maxlen=lines[k].length; }
      var fN=textFit(cw,ch,maxlen,nl,lg), fR=textFit(ch,cw,maxlen,nl,lg), rot=fR>fN*1.15, fs=rot?fR:fN, lh=fs*lg, y0=cy-(nl-1)*lh/2, tt='';
      for(var k2=0;k2<nl;k2++){ tt+='<text class="ptext" x="'+f2(cx)+'" y="'+f2(y0+k2*lh)+'" font-size="'+f2(fs)+'">'+esc(lines[k2])+'</text>'; }
      s+= rot?('<g transform="rotate(-90 '+f2(cx)+' '+f2(cy)+')">'+tt+'</g>'):tt;
    } else if(content.mode==='qr'){
      // Preview only (server renders the real QR): a small QR glyph plus the
      // payload text truncated, so different QR cells are distinguishable.
      var q=(content.text||'').trim(); if(!q) return '';
      var bs=Math.min(cw,ch)*0.42, bx=cx-bs/2, by=y+ch*0.12;
      s+='<rect x="'+f2(bx)+'" y="'+f2(by)+'" width="'+f2(bs)+'" height="'+f2(bs)+'" rx="0.6" fill="none" stroke="var(--accent)" stroke-width="0.5"/>';
      s+='<text class="ptext" x="'+f2(cx)+'" y="'+f2(by+bs*0.55)+'" font-size="'+f2(bs*0.42)+'">QR</text>';
      var lab=q.length>16?q.slice(0,15)+'…':q;
      var fs=Math.min(ch*0.15,(cw*0.92)/(Math.max(lab.length,1)*0.6));
      s+='<text class="ptext" x="'+f2(cx)+'" y="'+f2(y+ch*0.82)+'" font-size="'+f2(fs)+'">'+esc(lab)+'</text>';
    }
    return s;
  }
  function renderSheet(){
    var t=curTpl(); if(!t) return;
    var cols=t.cols, rows=t.rows, cw=t.cell_w, ch=t.cell_h, ml=t.margin_l, mt=t.margin_t, gx=t.gap_x||0, gy=t.gap_y||0;
    var pend=pendingContent();
    // Two passes: all cell fills first, then content + selection outlines on top,
    // so a selected/filled cell's border is never dimmed by a neighbor.
    var base='', over='';
    for(var i=0;i<cols*rows;i++){
      var r=Math.floor(i/cols), c=i%cols;
      var x=ml+c*(cw+gx), y=mt+r*(ch+gy), onSel=sel.has(i), filled=!!cellContent[i];
      base+='<rect class="cell'+(onSel?' sel':(filled?' filled':''))+'" data-i="'+i+'" x="'+f2(x)+'" y="'+f2(y)+'" width="'+f2(cw)+'" height="'+f2(ch)+'" rx="0.8"/>';
      var show=(onSel && pend) ? pend : cellContent[i];   // preview pending on selected cells
      if(show) over += drawCellContent(show, x, y, cw, ch);
      if(onSel) over += '<rect class="seloutline" x="'+f2(x)+'" y="'+f2(y)+'" width="'+f2(cw)+'" height="'+f2(ch)+'" rx="0.8"/>';
    }
    sheet.innerHTML='<rect class="paper" x="0" y="0" width="210" height="297" rx="2"/>'+base+over;
  }
  function updateUI(){
    var nSel=sel.size, nFilled=filledCount(), pend=pendingContent();
    var selFilled=false; sel.forEach(function(i){ if(cellContent[i]) selFilled=true; });
    selInfo.textContent = nSel ? (nSel+' cell'+(nSel===1?'':'s')+' selected')
                        : (nFilled ? (nFilled+' filled — tap a cell to edit') : 'Tap cells to place your label');
    addBtn.disabled = !(pend && nSel>0);
    addBtn.textContent = (pend && nSel>0) ? ('Add to '+nSel+' cell'+(nSel===1?'':'s')) : 'Add to sheet';
    eraseBtn.hidden = !selFilled;
    printBtn.disabled = printing || nFilled===0;
    printBtn.textContent = printing ? 'Printing…' : (nFilled ? ('Print sheet ('+nFilled+')') : 'Print sheet');
    clearSheetBtn.hidden = nFilled===0;
  }
  function setMode(m){
    pmode=m;
    segText.setAttribute('aria-selected', m==='text'?'true':'false');
    segFile.setAttribute('aria-selected', m==='file'?'true':'false');
    segQr.setAttribute('aria-selected', m==='qr'?'true':'false');
    textPane.hidden = m!=='text'; filePane.hidden = m!=='file'; qrPane.hidden = m!=='qr';
    renderSheet(); updateUI();
  }

  if(sheet){
    sheet.addEventListener('click',function(e){
      var r=e.target.closest('.cell'); if(!r) return;
      var i=+r.dataset.i;
      if(sel.has(i)) sel.delete(i); else sel.add(i);
      // Tapping a single filled cell (with an empty panel) loads it to edit.
      if(sel.size===1 && !pendingContent()){
        var only=sel.values().next().value;
        if(cellContent[only]) loadContentToPanel(cellContent[only]);
      }
      renderSheet(); updateUI();
    });
    document.getElementById('selAll').addEventListener('click',function(){
      var t=curTpl(); sel=new Set();
      for(var i=0;i<t.cols*t.rows;i++) sel.add(i);
      renderSheet(); updateUI();
    });
    document.getElementById('selNone').addEventListener('click',function(){ sel=new Set(); renderSheet(); updateUI(); });
    tplSel.addEventListener('change',function(){
      sel=new Set(); cellContent={};   // different layout -> start the sheet fresh
      try{ localStorage.setItem('pm_tpl',tplSel.value); }catch(e){}
      renderSheet(); updateUI();
    });
    ptext.addEventListener('input',function(){ renderSheet(); updateUI(); });
    pqr.addEventListener('input',function(){ renderSheet(); updateUI(); });
    segText.addEventListener('click',function(){ setMode('text'); });
    segFile.addEventListener('click',function(){ setMode('file'); });
    segQr.addEventListener('click',function(){ setMode('qr'); });
    function loadFileForPrint(file, name){
      fileNm = name || file.name || 'image';
      var reader=new FileReader();
      reader.onload=function(){
        var res=reader.result; fileData=res.slice(res.indexOf(',')+1);
        fileNameEl.textContent=fileNm; fileChip.hidden=false;
        if(/^image\//.test(file.type)){
          filePv.src=res; filePv.hidden=false;
          makeThumb(res,function(th,asp){ filePvUrl=th; fileAspect=asp||1; renderSheet(); });
        } else { filePv.hidden=true; filePvUrl=null; }  // PDF: no in-cell preview
        setMode('file'); updateUI();
      };
      reader.readAsDataURL(file);
    }
    function loadContentToPanel(content){   // put a cell's stored content back in the panel to edit
      if(content.mode==='text'){ setMode('text'); ptext.value=content.text||''; }
      else if(content.mode==='qr'){ setMode('qr'); pqr.value=content.text||''; }
      else {
        setMode('file');
        fileData=content.dataB64; fileNm=content.filename||'image'; fileAspect=content.aspect||1; filePvUrl=content.thumbUrl||null;
        fileNameEl.textContent=fileNm; fileChip.hidden=false;
        if(filePvUrl){ filePv.src=filePvUrl; filePv.hidden=false; } else { filePv.hidden=true; }
      }
    }
    pfile.addEventListener('change',function(){ var f=pfile.files[0]; if(f) loadFileForPrint(f); });
    // Paste an image from the clipboard (⌘V / Ctrl+V) while on the Print tab.
    document.addEventListener('paste',function(e){
      if(!printTabActive() || !sheetModal.hidden) return;
      var items=(e.clipboardData&&e.clipboardData.items)||[];
      for(var i=0;i<items.length;i++){
        if(items[i].type && items[i].type.indexOf('image/')===0){
          var blob=items[i].getAsFile(); if(!blob) continue;
          e.preventDefault();
          loadFileForPrint(blob, 'pasted-image.png');
          pnote.className='note ok'; pnote.textContent='Pasted image ready to print.';
          return;
        }
      }
    });
    fileClear.addEventListener('click',function(){ fileData=null; fileNm=''; filePvUrl=null; fileAspect=1; pfile.value=''; fileChip.hidden=true; filePv.hidden=true; renderSheet(); updateUI(); });

    // Build actions: stamp the current content into selected cells, or erase them.
    addBtn.addEventListener('click',function(){
      var pend=pendingContent(); if(!pend || sel.size===0) return;
      sel.forEach(function(i){ cellContent[i]=pend; });   // shared ref is fine (never mutated)
      sel=new Set();
      pnote.className='note'; pnote.textContent='';
      renderSheet(); updateUI();
    });
    eraseBtn.addEventListener('click',function(){
      sel.forEach(function(i){ delete cellContent[i]; });
      sel=new Set(); renderSheet(); updateUI();
    });
    clearSheetBtn.addEventListener('click',function(){
      if(!clearSheetBtn.classList.contains('armed')){ clearSheetBtn.classList.add('armed'); clearSheetBtn.textContent='Click again to clear the sheet';
        setTimeout(function(){ clearSheetBtn.classList.remove('armed'); clearSheetBtn.textContent='Clear sheet'; },3000); return; }
      cellContent={}; sel=new Set(); clearSheetBtn.classList.remove('armed'); clearSheetBtn.textContent='Clear sheet';
      renderSheet(); updateUI();
    });

    printBtn.addEventListener('click',function(){
      if(printBtn.disabled) return;
      var keys=Object.keys(cellContent); if(!keys.length) return;
      printing=true; updateUI(); pnote.className='note'; pnote.textContent=''; setStatus('busy','Printing');
      var count=keys.length, cells={};
      keys.forEach(function(k){
        var cc=cellContent[k];
        cells[k] = (cc.mode==='image') ? {mode:'file', dataB64:cc.dataB64, filename:cc.filename}
                 : (cc.mode==='qr') ? {mode:'qr', text:cc.text}
                 : {mode:'text', text:cc.text};
      });
      var body={template:curTpl().id, calX:0, calY:0, fontScale:0.9, cells:cells};
      var ctrl=new AbortController(), to=setTimeout(function(){ ctrl.abort(); }, 60000);
      fetch('/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal})
        .then(function(r){return r.json();})
        .then(function(d){ clearTimeout(to);
          if(d.ok){ setStatus('idle','Ready'); pnote.className='note ok';
            pnote.textContent='Sent '+count+' label'+(count===1?'':'s')+' to '+d.queue+'.'; }
          else { setStatus('error','Failed'); pnote.className='note err'; pnote.textContent=d.error||'Print failed.'; }
        })
        .catch(function(){ clearTimeout(to); setStatus('error','Failed'); pnote.className='note err'; pnote.textContent='Could not reach the print service.'; })
        .finally(function(){ printing=false; updateUI(); });
    });

    // --- manage sheets (add / edit / delete) ---
    ICON.ed = ICON.rn;
    var manageBtn=document.getElementById('manageBtn'), sheetModal=document.getElementById('sheetModal');
    var modalClose=document.getElementById('modalClose'), modalTitle=document.getElementById('modalTitle');
    var listView=document.getElementById('listView'), sheetList=document.getElementById('sheetList'), newSheet=document.getElementById('newSheet');
    var editView=document.getElementById('editView');
    var eName=document.getElementById('eName'), eCols=document.getElementById('eCols'), eRows=document.getElementById('eRows');
    var eML=document.getElementById('eML'), eMT=document.getElementById('eMT'), eGX=document.getElementById('eGX'), eGY=document.getElementById('eGY');
    var eSheet=document.getElementById('eSheet'), eCap=document.getElementById('eCap');
    var eSave=document.getElementById('eSave'), eDelete=document.getElementById('eDelete'), eCancel=document.getElementById('eCancel');
    var restoreBtn=document.getElementById('restoreBtn');
    var editingId='';

    function printTabActive(){ var p=document.getElementById('tab-print'); return !!(p && p.classList.contains('active')); }
    function r1(n){ return Math.round(n*10)/10; }
    var nameAuto=true;
    function genName(){ var c=parseInt(eCols.value,10)||0, r=parseInt(eRows.value,10)||0; return 'A4 · '+(c*r)+' labels ('+c+'×'+r+')'; }
    function syncName(){ if(nameAuto) eName.value=genName(); }
    function applyTemplates(list, selId){
      if(list) TEMPLATES=list;
      TBYID={}; TEMPLATES.forEach(function(t){ TBYID[t.id]=t; });
      var cur=selId||tplSel.value;
      tplSel.innerHTML=TEMPLATES.map(function(t){ return '<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>'; }).join('');
      if(TBYID[cur]) tplSel.value=cur; else if(TEMPLATES[0]) tplSel.value=TEMPLATES[0].id;
      sel=new Set(); renderSheet(); updateUI();
    }
    function deriveCells(v){
      var pw=v.page_w||210, ph=v.page_h||297;
      return {cw:(pw-2*v.margin_l-(v.cols-1)*v.gap_x)/v.cols, ch:(ph-2*v.margin_t-(v.rows-1)*v.gap_y)/v.rows};
    }
    function readForm(){
      return {id:editingId||'', name:eName.value, page_w:210, page_h:297,
        cols:parseInt(eCols.value,10), rows:parseInt(eRows.value,10),
        margin_l:parseFloat(eML.value), margin_t:parseFloat(eMT.value),
        gap_x:parseFloat(eGX.value), gap_y:parseFloat(eGY.value)};
    }
    var curHl=null;   // which field is focused -> red highlight in the schematic
    function buildSchematic(v, hl){
      eSheet.setAttribute('viewBox','0 0 210 297');
      var s='<rect class="paper" x="0" y="0" width="210" height="297" rx="2"/>';
      if(v){
        var d=deriveCells(v), cw=d.cw, ch=d.ch, ml=v.margin_l, mt=v.margin_t, gx=v.gap_x, gy=v.gap_y;
        if(cw>0 && ch>0){
          var topB='<rect class="'+(hl==='mt'?'hlband':'mband')+'" x="0" y="0" width="210" height="'+f2(mt)+'"/>';
          var leftB='<rect class="'+(hl==='ml'?'hlband':'mband')+'" x="0" y="0" width="'+f2(ml)+'" height="297"/>';
          s += (hl==='ml') ? (topB+leftB) : (leftB+topB);   // paint the highlighted band last so the corner overlap stays uniform
          for(var i=0;i<v.cols*v.rows;i++){
            var r=Math.floor(i/v.cols), c=i%v.cols;
            var cls='cell'+(((hl==='cols'&&r===0)||(hl==='rows'&&c===0))?' hl':'');
            s+='<rect class="'+cls+'" x="'+f2(ml+c*(cw+gx))+'" y="'+f2(mt+r*(ch+gy))+'" width="'+f2(cw)+'" height="'+f2(ch)+'" rx="0.6"/>';
          }
          // Gaps: a red strip of the real gap width, or a thin line at each cell
          // boundary when the gap is 0, so the field always shows what it controls.
          if(hl==='gx'){ var gw=gx>0?gx:1.2; for(var c2=0;c2<v.cols-1;c2++){ var gcx=ml+c2*(cw+gx)+cw+gx/2; s+='<rect class="hlgap" x="'+f2(gcx-gw/2)+'" y="'+f2(mt)+'" width="'+f2(gw)+'" height="'+f2(297-2*mt)+'"/>'; } }
          if(hl==='gy'){ var gh=gy>0?gy:1.2; for(var r2=0;r2<v.rows-1;r2++){ var gcy=mt+r2*(ch+gy)+ch+gy/2; s+='<rect class="hlgap" x="'+f2(ml)+'" y="'+f2(gcy-gh/2)+'" width="'+f2(210-2*ml)+'" height="'+f2(gh)+'"/>'; } }
        }
      }
      eSheet.innerHTML=s;
    }
    function updateEditor(){
      var v=readForm(), nums=[v.cols,v.rows,v.margin_l,v.margin_t,v.gap_x,v.gap_y];
      var named=!!v.name.trim();
      var valid=named && nums.every(function(x){ return !isNaN(x); }) &&
        v.cols>=1 && v.cols<=50 && v.rows>=1 && v.rows<=100 &&
        v.margin_l>=0 && v.margin_t>=0 && v.gap_x>=0 && v.gap_y>=0;
      var fits=false, cw, ch;
      if(valid){ var d=deriveCells(v); cw=d.cw; ch=d.ch; fits=(cw>=5 && ch>=5); }
      buildSchematic(valid?v:null, curHl);
      if(!named){ eCap.className='cellcap'; eCap.textContent='Name your sheet to save it.'; }
      else if(!valid){ eCap.className='cellcap err'; eCap.textContent='Enter valid numbers (cols 1–50, rows 1–100, margins/gaps ≥ 0).'; }
      else if(!fits){ eCap.className='cellcap err'; eCap.textContent="Doesn't fit A4 — reduce margins, gaps, or counts."; }
      else { eCap.className='cellcap'; eCap.textContent='Each label '+r1(cw)+' × '+r1(ch)+' mm · '+(v.cols*v.rows)+' per sheet'; }
      // While the layout overflows A4, cap each field's max at its current value
      // so the up-arrows can't make it worse (only the down-arrows work).
      var MX={eML:100,eMT:140,eGX:50,eGY:50,eCols:50,eRows:100};
      [eML,eMT,eGX,eGY,eCols,eRows].forEach(function(el){
        el.max = (valid && !fits) ? el.value : MX[el.id];
      });
      eSave.disabled=!(valid && fits);
    }
    function openEditor(t, mode){
      editingId = (mode==='edit') ? t.id : '';
      eName.value = mode==='edit' ? t.name : (mode==='duplicate' ? (t.name+' copy').slice(0,60) : '');
      eCols.value=t.cols; eRows.value=t.rows;
      eML.value=Math.round(t.margin_l); eMT.value=Math.round(t.margin_t);
      eGX.value=Math.round(t.gap_x||0); eGY.value=Math.round(t.gap_y||0);
      nameAuto = (!eName.value.trim() || eName.value===genName());
      syncName();
      eDelete.hidden = (mode!=='edit');
      eDelete.classList.remove('armed'); eDelete.textContent='Delete this sheet';
      modalTitle.textContent = mode==='new' ? 'New sheet' : (mode==='duplicate' ? 'Duplicate sheet' : 'Edit sheet');
      listView.hidden=true; editView.hidden=false;
      updateEditor(); eName.focus();
    }
    function renderList(){
      sheetList.innerHTML='';
      TEMPLATES.forEach(function(t){
        var row=document.createElement('div'); row.className='srow'; row.dataset.id=t.id;
        var star = (TEMPLATES.length>1)
          ? '<button type="button" class="act star'+(t.fav?' on':'')+'" data-a="fav" title="'+(t.fav?'Default sheet':'Make default')+'" aria-label="Favorite">'+(t.fav?ICON.starf:ICON.star)+'</button>'
          : '';
        var acts=star+
                 '<button type="button" class="act" data-a="edit" title="Edit" aria-label="Edit">'+ICON.ed+'</button>'+
                 '<button type="button" class="act" data-a="dup" title="Duplicate" aria-label="Duplicate">'+ICON.dup+'</button>'+
                 '<button type="button" class="act del" data-a="del" title="Delete" aria-label="Delete">'+ICON.rm+'</button>';
        row.innerHTML='<div class="info"><div class="nm">'+esc(t.name)+'</div>'+
          '<div class="sub">'+t.cols+'×'+t.rows+' · '+r1(t.cell_w)+'×'+r1(t.cell_h)+'mm · L '+Math.round(t.margin_l)+' T '+Math.round(t.margin_t)+'</div></div>'+
          '<div class="ra">'+acts+'</div>';
        sheetList.appendChild(row);
      });
    }
    function backToList(){ editView.hidden=true; listView.hidden=false; modalTitle.textContent='Label sheets'; renderList(); }
    function openModal(){ renderList(); listView.hidden=false; editView.hidden=true; modalTitle.textContent='Label sheets'; sheetModal.hidden=false; modalClose.focus(); }
    function closeModal(){ sheetModal.hidden=true; }
    function delReq(id, then){
      fetch('/templates/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
        .then(function(r){return r.json();}).then(function(d){ if(d.ok){ applyTemplates(d.templates); then&&then(); } }).catch(function(){});
    }
    manageBtn.addEventListener('click',openModal);
    modalClose.addEventListener('click',closeModal);
    sheetModal.addEventListener('click',function(e){ if(e.target===sheetModal) closeModal(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !sheetModal.hidden) closeModal(); });
    newSheet.addEventListener('click',function(){ openEditor(curTpl(),'new'); });
    eName.addEventListener('input',function(){ nameAuto=!eName.value.trim(); updateEditor(); });
    eCols.addEventListener('input',function(){ syncName(); updateEditor(); });
    eRows.addEventListener('input',function(){ syncName(); updateEditor(); });
    [eML,eMT,eGX,eGY].forEach(function(el){ el.addEventListener('input',updateEditor); });
    // Highlight the matching part of the diagram in red while a field is focused.
    var HLMAP={eCols:'cols',eRows:'rows',eML:'ml',eMT:'mt',eGX:'gx',eGY:'gy'};
    [eCols,eRows,eML,eMT,eGX,eGY].forEach(function(el){
      el.addEventListener('focus',function(){ curHl=HLMAP[el.id]||null; updateEditor(); });
      el.addEventListener('blur',function(){ curHl=null; updateEditor(); });
    });
    eCancel.addEventListener('click',backToList);
    eSave.addEventListener('click',function(){
      if(eSave.disabled) return;
      eSave.disabled=true; eSave.textContent='Saving…';
      function fail(msg){ eCap.className='cellcap err'; eCap.textContent=msg; eSave.disabled=false; eSave.textContent='Save sheet'; }
      var ctrl=new AbortController(), to=setTimeout(function(){ ctrl.abort(); }, 12000);
      fetch('/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(readForm()),signal:ctrl.signal})
        .then(function(r){return r.json();}).then(function(d){
          clearTimeout(to);
          if(d.ok){ applyTemplates(d.templates, d.id); backToList(); }
          else fail(d.error||'Could not save.');
        }).catch(function(){ clearTimeout(to); fail('Could not save — please try again.'); });
    });
    restoreBtn.addEventListener('click',function(){
      fetch('/templates/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        .then(function(r){return r.json();}).then(function(d){ if(d.ok){ applyTemplates(d.templates); renderList(); } }).catch(function(){});
    });
    eDelete.addEventListener('click',function(){
      if(!editingId) return;
      if(!eDelete.classList.contains('armed')){ eDelete.classList.add('armed'); eDelete.textContent='Click again to delete';
        setTimeout(function(){ eDelete.classList.remove('armed'); eDelete.textContent='Delete this sheet'; },3000); return; }
      delReq(editingId, backToList);
    });
    sheetList.addEventListener('click',function(e){
      var b=e.target.closest('[data-a]'); if(!b) return;
      var row=b.closest('.srow'), t=TBYID[row.dataset.id]; if(!t) return;
      var a=b.dataset.a;
      if(a==='fav'){
        fetch('/templates/favorite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:t.id})})
          .then(function(r){return r.json();}).then(function(d){ if(d.ok){ applyTemplates(d.templates); renderList(); } }).catch(function(){});
        return;
      }
      if(a==='edit') openEditor(t,'edit');
      else if(a==='dup') openEditor(t,'duplicate');
      else if(a==='del'){
        if(!b.classList.contains('armed')){ b.classList.add('armed'); b.title='Click again to delete';
          setTimeout(function(){ b.classList.remove('armed'); b.title='Delete'; },3000); return; }
        delReq(t.id, renderList);
      }
    });

    // The dropdown is already on the server-chosen sheet (favorite/first) and the
    // grid was rendered for it — don't override it here, or the sheet would swap.
    renderSheet(); updateUI();
  }

  // --- Devices manager (gear modal) + Print/Scan device selectors ----------
  (function(){
    var gear=document.getElementById('devicesBtn');
    if(!gear) return;  // devices disabled -> A4 composer stays the default
    var modal=document.getElementById('devicesModal'), invGroups=document.getElementById('invGroups');
    var niimList=document.getElementById('niimList'), candList=document.getElementById('candList');
    var devNote=document.getElementById('devNote');
    var printerSel=document.getElementById('printerSel'), printerSelRow=document.getElementById('printerSelRow');
    var scannerSel=document.getElementById('scannerSel'), scannerSelRow=document.getElementById('scannerSelRow');
    var a4C=document.getElementById('a4Composer'), labelC=document.getElementById('labelComposer');
    var nW=document.getElementById('niimW'), nH=document.getElementById('niimH');
    var nText=document.getElementById('nText'), nFile=document.getElementById('nFile'), nPv=document.getElementById('nPv');
    var nTextLbl=document.getElementById('nTextLbl'), niimBtn=document.getElementById('niimPrint');
    var nsegText=document.getElementById('nsegText'), nsegImg=document.getElementById('nsegImg'), nsegQr=document.getElementById('nsegQr');
    var devMain=document.getElementById('devMain'), devLogView=document.getElementById('devLogView');
    var devLog=document.getElementById('devLog'), logTitle=document.getElementById('logTitle');
    var state={printers:[],active:null,adapter:true,log:[]}, inventory=[];
    var kind='text', imgB64='', busy=false, curPrinter=null, lastApplied='', curLogAddr=null;

    function jpost(url, body){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body||{})}).then(function(r){return r.json();}); }
    function dnote(msg, cls){ devNote.textContent=msg||''; devNote.style.color = cls==='err'?'var(--danger)':'var(--muted)'; }

    // ---- per-device connection log (lines are tagged '[address] ...') --------
    function deviceLog(addr){ return (state.log||[]).filter(function(ln){ return ln.indexOf('['+addr+']')>=0; }); }
    function renderLog(){
      if(!curLogAddr) return;
      var lines=deviceLog(curLogAddr).map(function(ln){ return ln.split('] ').slice(1).join('] ')||ln; });
      devLog.textContent = lines.length ? lines.join('\n') : 'No log yet for this device.';
      devLog.scrollTop=devLog.scrollHeight;
    }
    function openLog(p){ curLogAddr=p.address; logTitle.textContent=p.name+' · log'; renderLog(); devMain.hidden=true; devLogView.hidden=false; }
    function closeLog(){ curLogAddr=null; devLogView.hidden=true; devMain.hidden=false; }
    document.getElementById('logBack').addEventListener('click',closeLog);
    document.getElementById('logCopy').addEventListener('click',function(){
      var b=this, text=devLog.textContent;
      function done(){ b.textContent='Copied'; setTimeout(function(){ b.textContent='Copy'; },1500); }
      function fail(){ b.textContent='Copy failed'; setTimeout(function(){ b.textContent='Copy'; },1500); }
      // navigator.clipboard only works in a secure context; the UI is plain HTTP,
      // so fall back to a hidden-textarea execCommand copy.
      function legacy(){
        var ta=document.createElement('textarea'); ta.value=text;
        ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        var ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
        document.body.removeChild(ta); ok?done():fail();
      }
      if(navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(done).catch(legacy); }
      else legacy();
    });
    document.getElementById('logClear').addEventListener('click',function(){
      jpost('/niimbot/clearlog',{address:curLogAddr}).then(function(r){ if(r.ok){ renderNiim(r); renderLog(); } });
    });

    // ---- modal open/close ----
    gear.addEventListener('click',function(){ modal.hidden=false; loadInv(false); loadNiim(); });
    function closeModal(){ modal.hidden=true; closeLog(); }
    document.getElementById('devModalClose').addEventListener('click',closeModal);
    modal.addEventListener('click',function(e){ if(e.target===modal) closeModal(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !modal.hidden) closeModal(); });
    document.getElementById('devRefresh').addEventListener('click',function(){
      var rb=this; rb.classList.add('spin');
      Promise.all([loadInv(true), loadNiim()]).catch(function(){}).then(function(){ rb.classList.remove('spin'); });
    });

    function updateBadge(){ gear.classList.toggle('alert', inventory.some(function(d){return d.status==='error';})); }

    // ---- icons + row helpers ------------------------------------------------
    var DICON={
      usb:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="20.5" r="1.5"/><path d="M11 19V4"/><path d="M8 7l3-3 3 3"/><path d="M11 13l4-2.5V8"/><rect x="13.6" y="6.4" width="2.8" height="2.4" rx=".4" fill="currentColor" stroke="none"/><path d="M11 10L7.5 8V6"/><circle cx="7.5" cy="5.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
      bluetooth:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l10 8-5 4V4l5 4-10 8"/></svg>',
      network:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.6 6 3.6 9s-1 6.3-3.6 9c-2.6-2.7-3.6-6-3.6-9S9.4 5.7 12 3z"/></svg>',
      test:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>',
      log:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
      forget:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
      reconnect:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
      disconnect:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg>',
      connect:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
    };
    var TRANSPORT={usb:'USB',bluetooth:'Bluetooth',network:'Network',cups:'Network',sane:'USB'};
    function ifaceLabel(t){ return TRANSPORT[t] || (t?t.toUpperCase():''); }
    function ifaceIcon(t){ var k=(t==='bluetooth')?'bluetooth':(t==='network'||t==='cups')?'network':'usb';
      return '<span class="ifi" title="'+esc(ifaceLabel(t))+'">'+DICON[k]+'</span>'; }
    function iconBtn(act, icon, title, cls){
      return '<button type="button" class="mini ic'+(cls?' '+cls:'')+'" data-act="'+act+'" title="'+esc(title)+'" aria-label="'+esc(title)+'">'+DICON[icon]+'</button>'; }
    function devRowHTML(name, transport, status, sub, isErr, acts){
      var dot = status==='error'?'err':(status==='connected'?'on':'');
      return '<i class="dot '+dot+'"></i>'+(transport?ifaceIcon(transport):'')+
        '<div class="dinfo"><div class="dname">'+esc(name)+'</div>'+
          '<div class="dsub'+(isErr?' derr':'')+'" title="'+esc(sub)+'">'+esc(sub)+'</div></div>'+
        '<div class="dacts">'+(acts||'')+'</div>';
    }
    function testPage(d, tb){
      if(tb.disabled) return; tb.disabled=true; dnote('Sending test page to '+d.name+'…');
      jpost('/devices/testpage',{kind:d.kind,id:d.id}).then(function(r){
        dnote(r.ok?('Test page sent to '+d.name):(r.error||'Test page failed'), r.ok?'':'err');
      }).catch(function(){ dnote('Test page failed','err'); }).finally(function(){ tb.disabled=false; });
    }
    function renderInv(devs){
      inventory = devs||[];
      invGroups.innerHTML='';
      var groups=[['printer','Printers'],['scanner','Scanners'],['usb','Other']], any=false;
      groups.forEach(function(g){
        var rows=inventory.filter(function(d){return d.kind===g[0];});
        if(!rows.length) return; any=true;
        var h=document.createElement('div'); h.className='grp'; h.textContent=g[1]; invGroups.appendChild(h);
        rows.forEach(function(d){
          var row=document.createElement('div'); row.className='drow';
          // Only auto-detected printers get a Test page; no Forget on USB/network hardware.
          var acts = (d.kind==='printer' && d.status==='connected' && d.id) ? iconBtn('test','test','Print test page') : '';
          row.innerHTML=devRowHTML(d.name, d.transport, d.status, d.error||d.detail||d.status, !!d.error, acts);
          var tb=row.querySelector('[data-act="test"]'); if(tb) tb.addEventListener('click',function(){ testPage(d, tb); });
          invGroups.appendChild(row);
        });
      });
      if(!any) invGroups.innerHTML='<p class="empty">No devices found.</p>';
      syncSelectors(); updateBadge();
    }
    function loadInv(force){
      return (force?jpost('/devices/refresh',{}):fetch('/devices/list').then(function(r){return r.json();}))
        .then(function(r){ renderInv(r.devices||[]); })
        .catch(function(){ invGroups.innerHTML='<p class="empty derr">Could not load devices.</p>'; });
    }

    // ---- niimbot management ----
    function renderNiim(st){
      state = st||state;
      if(curLogAddr) renderLog();   // keep an open per-device log fresh
      var prs = state.printers||[];
      document.getElementById('niimAdapter').hidden = (state.adapter!==false) || prs.length>0;
      niimList.innerHTML='';
      if(!prs.length){ niimList.innerHTML='<p class="empty">No Niimbot printers yet. Tap “Scan for printers”.</p>'; }
      prs.forEach(function(p){
        var row=document.createElement('div'); row.className='drow'+(p.active?' active':'');
        var conn = p.status==='connected';
        var hasLog = deviceLog(p.address).length>0;
        var acts = (conn? iconBtn('test','test','Print test label')+iconBtn('disconnect','disconnect','Disconnect')
                        : iconBtn('reconnect','reconnect','Reconnect','pri'))+
                   iconBtn('log','log','Connection log', hasLog?'on':'')+
                   iconBtn('forget','forget','Forget','warn');
        var sub = esc(p.name)+' · '+p.status+(p.label_mm?(' · '+p.label_mm[0]+'×'+p.label_mm[1]+' mm'):'');
        row.innerHTML='<i class="dot '+(conn?'on':'')+'"></i>'+ifaceIcon('bluetooth')+
          '<div class="dinfo"><div class="dname">'+esc(p.model_label||p.model)+'</div>'+
          '<div class="dsub" title="'+sub+'">'+sub+'</div></div>'+
          '<div class="dacts">'+acts+'</div>';
        row.querySelectorAll('[data-act]').forEach(function(bb){
          bb.addEventListener('click',function(){ if(bb.dataset.act==='log') openLog(p); else niimAction(bb.dataset.act, p, bb); });
        });
        niimList.appendChild(row);
      });
      syncSelectors(); updateBadge();
    }
    function loadNiim(){
      return fetch('/niimbot/state').then(function(r){return r.json();}).then(function(st){
        if(st.error) dnote(st.error,'err'); renderNiim(st);
      }).catch(function(){});
    }
    function niimAction(act, p, bb){
      if(busy) return;
      if(act==='test'){
        busy=true; bb.disabled=true; dnote('Printing test label…');
        jpost('/devices/testpage',{kind:'label-printer',id:p.address}).then(function(r){ dnote(r.ok?'Test label sent':(r.error||'Test failed'), r.ok?'':'err'); })
          .catch(function(){ dnote('Test failed','err'); }).finally(function(){ busy=false; bb.disabled=false; });
        return;
      }
      if(act==='forget' && !bb.classList.contains('armed')){ bb.classList.add('armed'); bb.title='Click again to remove';
        setTimeout(function(){ bb.classList.remove('armed'); bb.title='Forget'; },3000); return; }
      busy=true; dnote(act+'…'); bb.disabled=true;
      var url = act==='reconnect'?'/niimbot/reconnect':(act==='disconnect'?'/niimbot/disconnect':'/niimbot/forget');
      jpost(url,{address:p.address}).then(function(r){
        if(r.ok){ dnote(''); renderNiim(r); } else dnote(r.error||'Failed','err');
        loadInv(false);
      }).catch(function(){ dnote('Request failed','err'); }).finally(function(){ busy=false; bb.disabled=false; });
    }
    function renderCands(cands){
      candList.innerHTML='';
      var known={}; (state.printers||[]).forEach(function(p){known[p.address]=1;});
      cands=(cands||[]).filter(function(c){return !known[c.address];});
      if(!cands.length){ candList.innerHTML='<p class="hint">No new printers found.</p>'; return; }
      cands.forEach(function(c){
        var row=document.createElement('div'); row.className='drow';
        row.innerHTML='<i class="dot"></i>'+ifaceIcon('bluetooth')+'<div class="dinfo"><div class="dname">'+esc(c.name)+'</div>'+
          '<div class="dsub">'+esc(c.address)+' · '+(c.rssi||'')+' dBm</div></div>'+
          '<div class="dacts"><button type="button" class="mini ic pri" data-connect="1" title="Connect" aria-label="Connect">'+DICON.connect+'</button></div>';
        row.querySelector('[data-connect]').addEventListener('click',function(bev){
          var bb=bev.target; if(busy) return; busy=true; bb.disabled=true; dnote('Connecting…');
          jpost('/niimbot/connect',{address:c.address,name:c.name}).then(function(r){
            if(r.ok){ dnote(''); candList.innerHTML=''; renderNiim(r); loadInv(false); } else dnote(r.error||'Connect failed','err');
          }).catch(function(){ dnote('Connect failed','err'); }).finally(function(){ busy=false; bb.disabled=false; });
        });
        candList.appendChild(row);
      });
    }
    document.getElementById('niimScan').addEventListener('click',function(){
      if(busy) return; busy=true; var b=this; b.disabled=true; dnote('Scanning for Bluetooth printers…');
      jpost('/niimbot/scan',{}).then(function(r){
        if(r.ok){ dnote(''); renderCands(r.candidates); } else dnote(r.error||'Scan failed','err');
      }).catch(function(){ dnote('Scan failed','err'); }).finally(function(){ busy=false; b.disabled=false; });
    });

    // ---- Print/Scan selectors (fed from inventory + niimbot state) ----------
    function printerOptions(){
      var opts=[];
      inventory.forEach(function(d){ if(d.kind==='printer' && d.id) opts.push({v:'cups:'+d.id, label:d.name, type:'cups', id:d.id}); });
      (state.printers||[]).forEach(function(p){ if(p.status==='connected') opts.push({v:'niim:'+p.address, label:p.name+' — '+(p.model_label||p.model), type:'niim', address:p.address, label_mm:p.label_mm}); });
      return opts;
    }
    function syncSelectors(){
      var opts=printerOptions();
      if(opts.length){
        var prev = curPrinter ? curPrinter.v : (function(){try{return localStorage.getItem('pm_printer')||'';}catch(e){return '';}})();
        printerSel.innerHTML = opts.map(function(o){ return '<option value="'+esc(o.v)+'">'+esc(o.label)+'</option>'; }).join('');
        var match = opts.filter(function(o){return o.v===prev;})[0] || opts[0];
        printerSel.value = match.v; printerSelRow.hidden = opts.length<2;
        applyPrinter(match);
      } else { printerSelRow.hidden=true; }
      var scs=inventory.filter(function(d){return d.kind==='scanner' && d.status==='connected' && d.id;});
      scannerSel.innerHTML = scs.map(function(d){ return '<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>'; }).join('');
      scannerSelRow.hidden = scs.length<2;
    }
    function applyPrinter(o){
      var changed = o.v!==lastApplied; lastApplied=o.v; curPrinter=o;
      try{ localStorage.setItem('pm_printer', o.v); }catch(e){}
      var isNiim = o.type==='niim';
      a4C.hidden = isNiim; labelC.hidden = !isNiim;
      if(isNiim){
        if(changed){ jpost('/niimbot/select',{address:o.address}); if(o.label_mm){ nW.value=o.label_mm[0]; nH.value=o.label_mm[1]; } }
        updateNiimBtn();
      }
    }
    printerSel.addEventListener('change',function(){
      var o=printerOptions().filter(function(x){return x.v===printerSel.value;})[0]; if(o) applyPrinter(o);
    });

    // ---- Niimbot label composer (in the Print tab) --------------------------
    function setKind(k){ kind=k;
      nsegText.setAttribute('aria-selected', k==='text'?'true':'false');
      nsegImg.setAttribute('aria-selected', k==='image'?'true':'false');
      nsegQr.setAttribute('aria-selected', k==='qr'?'true':'false');
      document.getElementById('nTextPane').hidden = (k==='image');
      document.getElementById('nImgPane').hidden = (k!=='image');
      nTextLbl.innerHTML = (k==='qr')?'Text or URL':'Text <span class="opt">one line per row</span>';
      updateNiimBtn();
    }
    nsegText.addEventListener('click',function(){setKind('text');});
    nsegImg.addEventListener('click',function(){setKind('image');});
    nsegQr.addEventListener('click',function(){setKind('qr');});
    nText.addEventListener('input',updateNiimBtn);
    nFile.addEventListener('change',function(){
      var f=nFile.files&&nFile.files[0]; imgB64=''; nPv.hidden=true;
      if(!f) return updateNiimBtn();
      var rd=new FileReader(); rd.onload=function(){ var s=rd.result||''; imgB64=(s.split(',')[1]||''); nPv.src=s; nPv.hidden=false; updateNiimBtn(); }; rd.readAsDataURL(f);
    });
    function saveSize(){ if(curPrinter && curPrinter.type==='niim') jpost('/niimbot/labelsize',{address:curPrinter.address,w:parseFloat(nW.value),h:parseFloat(nH.value)}); }
    nW.addEventListener('change',saveSize); nH.addEventListener('change',saveSize);
    function hasContent(){ return kind==='image'? !!imgB64 : !!nText.value.trim(); }
    function updateNiimBtn(){ niimBtn.disabled = busy || !(curPrinter && curPrinter.type==='niim') || !hasContent(); }
    niimBtn.addEventListener('click',function(){
      if(busy||niimBtn.disabled) return; busy=true; niimBtn.disabled=true;
      var old=niimBtn.textContent; niimBtn.textContent='Printing…'; setStatus('busy','Printing');
      pnote.className='note'; pnote.textContent='';
      var body={kind:kind,address:curPrinter.address};
      if(kind==='image') body.dataB64=imgB64; else body.text=nText.value.trim();
      jpost('/niimbot/print',body).then(function(r){
        if(r.ok){ setStatus('idle','Ready'); pnote.className='note ok'; pnote.textContent='Printed label ✓'; }
        else { setStatus('error','Failed'); pnote.className='note err'; pnote.textContent=r.error||'Print failed.'; }
      }).catch(function(){ setStatus('error','Failed'); pnote.className='note err'; pnote.textContent='Print failed.'; })
        .finally(function(){ busy=false; niimBtn.textContent=old; updateNiimBtn(); });
    });

    // Populate selectors on load (no modal needed).
    loadInv(false); loadNiim();
  })();

  // open the tab named by the URL (/scan, /print, /devices)
  selectTab(pathTab(), false);

  refresh();
  setInterval(function(){ if(!scanning && !tbody.querySelector('.edit')) refresh(); }, 15000);
})();
</script>
</body>
</html>"""


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
