#!/usr/bin/env python3
"""Niimbot BLE label-printer support for the printmanager web UI.

Ported to Python from the moverse mobile app's proven, device-verified stack
(mobile/src/niimbot/{packet,models,transport,client,label}.ts). The wire
protocol, print sequence, per-model printhead widths, and reliability tuning
(repeat-run merging, batched acked writes with a no-response fallback, status
poll to physical completion) all come from there.

Runtime deps beyond stdlib: `bleak` (BLE), Pillow (raster), `qrcode` (QR). They
are imported lazily so scan-web still runs when the Devices tab is disabled.

Threading model: BLE is async and a BleakClient must live on the loop that
created it and persist between HTTP requests. So this module runs ONE background
asyncio loop in a daemon thread; the synchronous HTTP handlers call the sync
facade methods on `manager`, which marshal coroutines onto that loop.
"""
import os
import json
import asyncio
import threading

# --- BLE constants (from printers.niim.blue / moverse transport.ts) ----------
SERVICE = "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
CHAR = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"

DATA_DIR = os.environ.get("SCAN_WEB_DATA", "/var/lib/scan-web")
STORE = os.path.join(DATA_DIR, "niimbot-devices.json")

DPMM = 8  # 203 dpi ≈ 8 px/mm


# --- Packet framing:  55 55 <type> <len> <data...> <xor> AA AA ---------------
class Packet:
    def __init__(self, ptype, data):
        self.type = ptype
        self.data = bytes(data)

    def to_bytes(self):
        length = len(self.data)
        checksum = self.type ^ length
        for b in self.data:
            checksum ^= b
        return bytes([0x55, 0x55, self.type, length, *self.data, checksum & 0xFF, 0xAA, 0xAA])


class Reassembler:
    """Accumulate possibly-fragmented notification bytes; yield whole frames."""

    def __init__(self):
        self.buf = bytearray()

    def push(self, data):
        self.buf.extend(data)
        out = []
        while len(self.buf) >= 7:
            if self.buf[0] != 0x55 or self.buf[1] != 0x55:
                del self.buf[0]
                continue
            length = self.buf[3]
            frame_len = length + 7
            if len(self.buf) < frame_len:
                break
            ptype = self.buf[2]
            payload = bytes(self.buf[4:4 + length])
            out.append(Packet(ptype, payload))
            del self.buf[:frame_len]
        return out


# --- Model registry (from moverse models.ts) --------------------------------
# id, label, name-match tokens, printhead width px, default label (w×h mm).
MODELS = [
    {"id": "b18", "label": "Niimbot B18", "match": ["b18"], "width": 240, "label_mm": (15, 40)},
    {"id": "b21", "label": "Niimbot B21", "match": ["b21"], "width": 384, "label_mm": (40, 30)},
    {"id": "b1", "label": "Niimbot B1", "match": ["b1"], "width": 384, "label_mm": (45, 80)},
    {"id": "d110", "label": "Niimbot D110", "match": ["d110"], "width": 96, "label_mm": (12, 40)},
    {"id": "d11", "label": "Niimbot D11", "match": ["d11"], "width": 96, "label_mm": (12, 40)},
]
DEFAULT_MODEL = next(m for m in MODELS if m["id"] == "b1")  # widest verified head


def _token_match(haystack, token):
    """Anchored (word-boundary) match so 'b1' doesn't hit 'Room-B1'/'B18'."""
    import re
    return bool(re.search(r"(^|[^a-z0-9])%s([^a-z0-9]|$)" % re.escape(token), haystack, re.I))


def is_niimbot_name(name):
    n = (name or "").lower()
    if not n:
        return False
    if _token_match(n, "niimbot"):
        return True
    return any(_token_match(n, t) for m in MODELS for t in m["match"])


def detect_model(name):
    n = (name or "").lower()
    for m in MODELS:  # ordered most-specific first
        if any(_token_match(n, t) for t in m["match"]):
            return m
    return DEFAULT_MODEL


def model_by_id(mid):
    return next((m for m in MODELS if m["id"] == mid), DEFAULT_MODEL)


# --- Background asyncio loop (one, shared) -----------------------------------
_loop = None
_loop_lock = threading.Lock()


def _get_loop():
    global _loop
    with _loop_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            t = threading.Thread(target=_loop.run_forever, name="niimbot-loop", daemon=True)
            t.start()
    return _loop


def run_coro(coro, timeout=90):
    """Submit a coroutine to the background loop and block for its result."""
    fut = asyncio.run_coroutine_threadsafe(coro, _get_loop())
    return fut.result(timeout=timeout)


# --- BLE transport (bleak) ---------------------------------------------------
class Transport:
    def __init__(self, log=lambda s: None):
        self.log = log
        self.client = None
        self.reasm = Reassembler()
        self.chunk = 20
        self._listeners = []
        self.on_disconnect = None
        self._disc_fired = False
        self._up = False

    def on_packet(self, cb):
        self._listeners.append(cb)

    def _notify(self, _sender, data):
        for pkt in self.reasm.push(data):
            for cb in self._listeners:
                cb(pkt)

    async def connect(self, address):
        from bleak import BleakClient

        def _disc(_c):
            # Ignore drops during the connect handshake — the retry loop owns
            # those; only report a disconnect once we're fully up.
            if not self._up or self._disc_fired:
                return
            self._disc_fired = True
            self.log("printer disconnected")
            if self.on_disconnect:
                self.on_disconnect()

        # Niimbots frequently drop the first BlueZ connect mid-handshake; retry a
        # few times before giving up (a later attempt usually sticks).
        self._up = False
        last = None
        for attempt in range(4):
            client = BleakClient(address, disconnected_callback=_disc, timeout=15)
            try:
                await client.connect()
                if not client.is_connected:
                    raise RuntimeError("link dropped during connect")
                # start_notify resolves GATT services on BlueZ (also lets acks in).
                await client.start_notify(CHAR, self._notify)
                self.client = client
                self._up = True
                break
            except Exception as e:
                last = e
                self.log("connect attempt %d failed: %r" % (attempt + 1, e))
                try:
                    await client.disconnect()
                except Exception:
                    pass
                await asyncio.sleep(0.6)
        if not self._up:
            raise last or RuntimeError("connect failed")

        # Explicitly negotiate the ATT MTU (BlueZ private helper) so mtu_size
        # returns the real value instead of warning + defaulting to 23.
        try:
            if hasattr(self.client, "_acquire_mtu"):
                await self.client._acquire_mtu()
        except Exception:
            pass
        mtu = 23
        try:
            mtu = self.client.mtu_size or 23
        except Exception:
            pass
        self.chunk = max(20, mtu - 3)
        self.log("connected, mtu=%s" % mtu)
        return self.client

    async def write(self, data, response=False):
        if not self.client:
            raise RuntimeError("not connected")
        for i in range(0, len(data), self.chunk):
            await self.client.write_gatt_char(CHAR, bytes(data[i:i + self.chunk]), response=response)

    async def disconnect(self):
        try:
            if self.client:
                await self.client.disconnect()
        except Exception:
            pass
        self.client = None

    @property
    def connected(self):
        return bool(self.client and self.client.is_connected)


# --- Print client (from moverse client.ts) -----------------------------------
T_SET_DENSITY = 0x21
T_SET_LABEL_TYPE = 0x23
T_SET_PAGE_SIZE = 0x13
T_PRINT_START = 0x01
T_PRINT_END = 0xF3
T_PAGE_START = 0x03
T_PAGE_END = 0xE3
T_BITMAP_ROW = 0x85
T_BITMAP_ROW_INDEXED = 0x83
T_EMPTY_ROW = 0x84
T_GET_STATUS = 0xA3
RESP_STATUS = 0xB3
RESP_MAP = {0x21: 0x31, 0x23: 0x33, 0x01: 0x02, 0x03: 0x04,
            0x13: 0x14, 0xE3: 0xE4, 0xF3: 0xF4}
HEAD_PX = 384
ROW_FLUSH_BYTES = 480


def _u16(n):
    return [(n >> 8) & 0xFF, n & 0xFF]


def _count_parts(row):
    """Per-third black-pixel counts the printer needs per row packet."""
    total = 0
    parts = [0, 0, 0]
    chunk_size = HEAD_PX // 8 // 3  # 16 bytes
    split = len(row) <= chunk_size * 3
    for byte_n, value in enumerate(row):
        chunk_idx = byte_n // chunk_size
        for bit_n in range(8):
            if value & (1 << bit_n):
                total += 1
                if split and chunk_idx <= 2:
                    parts[chunk_idx] += 1
    if split:
        return total, parts
    return total, [0, total & 0xFF, (total >> 8) & 0xFF]


def _index_pixels(row):
    out = []
    for byte_pos, b in enumerate(row):
        for bit_pos in range(8):
            if b & (1 << (7 - bit_pos)):
                out.extend(_u16(byte_pos * 8 + bit_pos))
    return out


class Client:
    def __init__(self, transport, log=lambda s: None):
        self.t = transport
        self.log = log
        self._waiters = []  # list of [type, asyncio.Future]
        self._ack_mode = "unknown"
        self._rowbuf = bytearray()
        transport.on_packet(self._on_packet)

    def _on_packet(self, pkt):
        for i in range(len(self._waiters) - 1, -1, -1):
            wtype, fut = self._waiters[i]
            if wtype == pkt.type and not fut.done():
                fut.set_result(pkt)
                del self._waiters[i]

    def _register(self, ptype):
        """Register a response waiter SYNCHRONOUSLY (before the write) so a fast
        reply can't arrive before the waiter exists. Returns a future."""
        fut = asyncio.get_running_loop().create_future()
        self._waiters.append([ptype, fut])
        return fut

    async def _await(self, fut, timeout):
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            self._waiters = [w for w in self._waiters if w[1] is not fut]
            return None

    async def _send(self, ptype, data):
        resp = RESP_MAP.get(ptype)
        fut = self._register(resp) if resp is not None else None
        await self.t.write(Packet(ptype, data).to_bytes())
        if fut is not None:
            if await self._await(fut, 1.5) is None:
                self.log("  (no ack for 0x%x)" % ptype)
        else:
            await asyncio.sleep(0.01)

    async def _send_recv(self, ptype, data, resp_type, timeout):
        fut = self._register(resp_type)
        await self.t.write(Packet(ptype, data).to_bytes())
        return await self._await(fut, timeout)

    def _queue_row(self, ptype, data):
        self._rowbuf.extend(Packet(ptype, data).to_bytes())

    async def _flush_rows(self):
        if not self._rowbuf:
            return
        data = bytes(self._rowbuf)
        self._rowbuf.clear()
        if self._ack_mode != "noack":
            try:
                await self.t.write(data, response=True)
                if self._ack_mode == "unknown":
                    self._ack_mode = "ack"
                return
            except Exception:
                if self._ack_mode == "unknown":
                    self._ack_mode = "noack"
        await self.t.write(data, response=False)

    async def ping(self, timeout=1.5):
        return (await self._send_recv(T_GET_STATUS, [1], RESP_STATUS, timeout)) is not None

    async def print_image(self, width, height, data, density=3, label_type=1):
        """data: 1bpp MSB-first, ceil(width/8) bytes/row, black=1."""
        self._ack_mode = "unknown"
        self._rowbuf.clear()
        bpr = (width + 7) // 8
        total_pages = 1

        await self._send(T_SET_DENSITY, [density])
        await self._send(T_SET_LABEL_TYPE, [label_type])
        await self._send(T_PRINT_START, [*_u16(total_pages), 0, 0, 0, 0, 0])
        await self._send(T_PAGE_START, [1])
        await self._send(T_SET_PAGE_SIZE, [*_u16(height), *_u16(width), *_u16(1)])

        y = 0
        while y < height:
            row = data[y * bpr:(y + 1) * bpr]
            is_void = not any(row)
            # Merge identical consecutive rows into a repeat count (1 byte, cap 255).
            repeat = 1
            while y + repeat < height and repeat < 255:
                nxt = data[(y + repeat) * bpr:(y + repeat + 1) * bpr]
                if nxt != row:
                    break
                repeat += 1
            if is_void:
                self._queue_row(T_EMPTY_ROW, [*_u16(y), repeat])
            else:
                total, parts = _count_parts(row)
                if total <= 6:
                    self._queue_row(T_BITMAP_ROW_INDEXED, [*_u16(y), *parts, repeat, *_index_pixels(row)])
                else:
                    self._queue_row(T_BITMAP_ROW, [*_u16(y), *parts, repeat, *row])
            if len(self._rowbuf) >= ROW_FLUSH_BYTES:
                await self._flush_rows()
                await asyncio.sleep(0.004)  # pacing for small-buffer printers (D110)
            y += repeat
        await self._flush_rows()
        self.log("sent %d rows" % height)

        await self._send(T_PAGE_END, [1])

        # Wait for the printer to PHYSICALLY finish before ending the job.
        printed = 0
        for _ in range(80):
            resp = await self._send_recv(T_GET_STATUS, [1], RESP_STATUS, 0.5)
            if resp:
                d = resp.data
                page = (d[0] << 8) | d[1] if len(d) >= 2 else 0
                err = d[6] if len(d) >= 10 else 0
                if err:
                    raise RuntimeError("print error %d" % err)
                printed = page
                if page >= total_pages:
                    break
            await asyncio.sleep(0.25)

        await self._send(T_PRINT_END, [1])
        self.log("print done" if printed >= total_pages else "print timed out")


# --- Label rendering (Pillow; layout from moverse label.ts) ------------------
def _label_px(model, label_mm):
    """Physical bitmap size: width clamped to head (multiple of 8), height=length."""
    w_mm, h_mm = label_mm
    width = min(model["width"], (int(round(w_mm * DPMM)) // 8) * 8) or 8
    height = max(8, int(round(h_mm * DPMM)))
    return width, height


def _pack_1bpp(img):
    """PIL 'L' image -> (width, height, bytes) 1bpp MSB-first, black(<128)=1."""
    w, h = img.size
    px = img.load()
    bpr = (w + 7) // 8
    out = bytearray(bpr * h)
    for y in range(h):
        base = y * bpr
        for x in range(w):
            if px[x, y] < 128:
                out[base + (x >> 3)] |= 0x80 >> (x & 7)
    return w, h, bytes(out)


# Bold sans candidates, tried in order; first that loads wins. The absolute
# Linux paths cover the Pi (fonts-dejavu-core); the bare names cover other hosts.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "DejaVuSans-Bold.ttf", "DejaVuSans.ttf",
]


def _load_font(size):
    from PIL import ImageFont
    for cand in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    return None


def _fit_font(draw, text, max_w, max_h):
    from PIL import ImageFont
    lines = text.split("\n") or [text]
    lo, hi, best = 6, max(8, max_h), None
    while lo <= hi:
        size = (lo + hi) // 2
        font = _load_font(size)
        if font is None:
            return ImageFont.load_default(), lines
        widths, total_h = [], 0
        for ln in lines:
            box = draw.textbbox((0, 0), ln or " ", font=font)
            widths.append(box[2] - box[0])
            total_h += (box[3] - box[1]) + max(2, size // 6)
        if max(widths) <= max_w and total_h <= max_h:
            best = (font, lines)
            lo = size + 1
        else:
            hi = size - 1
    if best:
        return best
    return ImageFont.load_default(), lines


def _render_landscape_text(text, lw, lh):
    """Draw text centered, as large as fits, on a white LxH 'L' canvas."""
    from PIL import Image, ImageDraw
    img = Image.new("L", (lw, lh), 255)
    draw = ImageDraw.Draw(img)
    margin = max(4, round(min(lw, lh) * 0.06))
    font, lines = _fit_font(draw, text, lw - 2 * margin, lh - 2 * margin)
    heights = [draw.textbbox((0, 0), ln or " ", font=font)[3] for ln in lines]
    gap = max(2, (font.size if hasattr(font, "size") else 12) // 6)
    total_h = sum(heights) + gap * (len(lines) - 1)
    y = (lh - total_h) // 2
    for ln, hh in zip(lines, heights):
        w = draw.textlength(ln, font=font)
        draw.text(((lw - w) / 2, y), ln, fill=0, font=font)
        y += hh + gap
    return img


def _render_landscape_qr(payload, lw, lh):
    from PIL import Image
    import qrcode
    qr = qrcode.QRCode(border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(payload)
    qr.make(fit=True)
    side = min(lw, lh) - max(4, round(min(lw, lh) * 0.06)) * 2
    qimg = qr.make_image(fill_color="black", back_color="white").convert("L")
    qimg = qimg.resize((max(8, side), max(8, side)), Image.NEAREST)
    canvas = Image.new("L", (lw, lh), 255)
    canvas.paste(qimg, ((lw - qimg.width) // 2, (lh - qimg.height) // 2))
    return canvas


def _render_landscape_image(raw, lw, lh):
    from PIL import Image, ImageOps
    import io
    src = Image.open(io.BytesIO(raw))
    src = ImageOps.exif_transpose(src).convert("L")
    fitted = ImageOps.contain(src, (lw, lh))
    canvas = Image.new("L", (lw, lh), 255)
    canvas.paste(fitted, ((lw - fitted.width) // 2, (lh - fitted.height) // 2))
    return canvas.convert("1").convert("L")  # Floyd–Steinberg dither to 1-bit


def render_label(kind, payload, model, label_mm):
    """Return (width, height, data) 1bpp for the given content kind."""
    from PIL import Image
    width, height = _label_px(model, label_mm)
    portrait = height > width  # narrow tape (D110): lay out along the length
    lw, lh = (height, width) if portrait else (width, height)
    if kind == "qr":
        img = _render_landscape_qr(payload, lw, lh)
    elif kind == "image":
        img = _render_landscape_image(payload, lw, lh)
    else:
        img = _render_landscape_text(str(payload), lw, lh)
    if portrait:
        img = img.rotate(-90, expand=True)  # into physical (width×height)
    return _pack_1bpp(img)


# --- Persistence -------------------------------------------------------------
def _load_store():
    try:
        with open(STORE) as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    except (OSError, ValueError):
        pass
    return {"printers": [], "active": None}


def _save_store(d):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STORE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
    os.replace(tmp, STORE)


class ManagedPrinter:
    def __init__(self, address, name, model, transport, client, label_mm):
        self.address = address
        self.name = name
        self.model = model
        self.transport = transport
        self.client = client
        self.label_mm = label_mm
        self.lock = asyncio.Lock()

    @property
    def connected(self):
        return self.transport.connected


class PrinterManager:
    """Owns the set of Niimbot links + the remembered set + active selection.
    Async methods run on the background loop; sync_* facades are called by the
    (synchronous) HTTP handlers via run_coro."""

    def __init__(self):
        import collections
        self._logs = collections.deque(maxlen=300)
        self.printers = {}  # address -> ManagedPrinter (live)
        store = _load_store()
        self.remembered = {p["address"]: p for p in store.get("printers", [])}
        self.active = store.get("active")

    def log(self, s):
        self._logs.append(s)

    def recent_log(self):
        return list(self._logs)

    def clear_log(self, address=None):
        """Clear the log; if an address is given, drop only that device's lines
        (lines are tagged with the device id as '[address] ...')."""
        if not address:
            self._logs.clear()
            return
        tag = "[%s]" % address
        kept = [ln for ln in self._logs if tag not in ln]
        self._logs.clear()
        self._logs.extend(kept)

    # --- persistence
    def _persist(self):
        _save_store({"printers": list(self.remembered.values()), "active": self.active})

    def _remember(self, mp):
        self.remembered[mp.address] = {
            "address": mp.address, "name": mp.name, "model": mp.model["id"],
            "label_mm": list(mp.label_mm),
        }
        self._persist()

    # --- adapter
    async def adapter_ok(self):
        try:
            from bleak import BleakScanner
            await BleakScanner.discover(timeout=0.1)
            return True
        except Exception as e:
            self.log("adapter check failed: %s" % e)
            return False

    # --- discovery
    async def scan(self, timeout=6.0):
        from bleak import BleakScanner
        found = {}
        devs = await BleakScanner.discover(timeout=timeout, return_adv=True)
        for address, (dev, adv) in devs.items():
            name = dev.name or (adv.local_name if adv else "") or ""
            svcs = [u.lower() for u in (adv.service_uuids if adv else [])]
            if is_niimbot_name(name) or SERVICE.lower() in svcs:
                found[address] = {"address": address, "name": name or address,
                                  "rssi": adv.rssi if adv else -999,
                                  "model": detect_model(name)["id"]}
        return sorted(found.values(), key=lambda c: c["rssi"], reverse=True)

    # --- connection
    async def _open(self, address, name, model_id=None, label_mm=None):
        existing = self.printers.get(address)
        if existing and existing.connected:
            return existing
        if existing:
            # Stale entry whose BLE link died without a disconnect event — drop it
            # so we actually reconnect instead of returning a dead handle.
            self.printers.pop(address, None)
            try:
                await existing.transport.disconnect()
            except Exception:
                pass
        t = Transport(lambda s: self.log("[%s] %s" % (address, s)))

        def _dropped():
            mp = self.printers.get(address)
            if mp and mp.transport is t:
                del self.printers[address]
        t.on_disconnect = _dropped
        self.log("[%s] connecting…" % address)
        try:
            await t.connect(address)
        except Exception as e:
            self.log("[%s] connect failed: %s" % (address, e))
            raise
        client = Client(t, lambda s: self.log("[%s] %s" % (address, s)))
        try:
            await client.ping()
        except Exception:
            pass
        model = model_by_id(model_id) if model_id else detect_model(name)
        lm = tuple(label_mm) if label_mm else model["label_mm"]
        mp = ManagedPrinter(address, name, model, t, client, lm)
        self.printers[address] = mp
        if self.active is None:
            self.active = address
        self._remember(mp)
        return mp

    async def connect(self, address, name=None):
        return await self._open(address, name or address)

    async def reconnect(self, address):
        r = self.remembered.get(address)
        if not r:
            raise RuntimeError("not a remembered printer")
        return await self._open(address, r["name"], r.get("model"), r.get("label_mm"))

    async def disconnect(self, address):
        mp = self.printers.get(address)
        if mp:
            await mp.transport.disconnect()
            self.printers.pop(address, None)

    async def forget(self, address):
        await self.disconnect(address)
        self.remembered.pop(address, None)
        if self.active == address:
            self.active = next(iter(self.printers), None) or next(iter(self.remembered), None)
        self._persist()

    def select(self, address):
        if address in self.remembered or address in self.printers:
            self.active = address
            self._persist()

    def set_label_mm(self, address, w_mm, h_mm):
        lm = (float(w_mm), float(h_mm))
        mp = self.printers.get(address)
        if mp:
            mp.label_mm = lm
        if address in self.remembered:
            self.remembered[address]["label_mm"] = list(lm)
            self._persist()

    async def print_label(self, kind, payload, address=None):
        address = address or self.active
        mp = self.printers.get(address) if address else None
        if not mp or not mp.connected:
            raise RuntimeError("no active printer connected")
        width, height, data = render_label(kind, payload, mp.model, mp.label_mm)
        async with mp.lock:
            await mp.client.print_image(width, height, data)
        return {"width": width, "height": height}

    def state(self):
        rows = []
        seen = set()
        for addr, mp in self.printers.items():
            seen.add(addr)
            rows.append({"address": addr, "name": mp.name, "model": mp.model["id"],
                         "model_label": mp.model["label"],
                         "status": "connected" if mp.connected else "disconnected",
                         "label_mm": list(mp.label_mm), "active": addr == self.active})
        for addr, r in self.remembered.items():
            if addr in seen:
                continue
            m = model_by_id(r.get("model"))
            rows.append({"address": addr, "name": r["name"], "model": m["id"],
                         "model_label": m["label"], "status": "disconnected",
                         "label_mm": r.get("label_mm", list(m["label_mm"])),
                         "active": addr == self.active})
        return rows

    # --- synchronous facades for the HTTP handlers ---------------------------
    def sync_scan(self, timeout=6.0):
        return run_coro(self.scan(timeout), timeout=timeout + 5)

    def sync_connect(self, address, name=None):
        run_coro(self.connect(address, name), timeout=30)

    def sync_reconnect(self, address):
        run_coro(self.reconnect(address), timeout=30)

    def sync_disconnect(self, address):
        run_coro(self.disconnect(address), timeout=15)

    def sync_forget(self, address):
        run_coro(self.forget(address), timeout=15)

    def sync_print(self, kind, payload, address=None):
        return run_coro(self.print_label(kind, payload, address), timeout=120)

    def sync_adapter_ok(self):
        try:
            return run_coro(self.adapter_ok(), timeout=8)
        except Exception:
            return False


manager = PrinterManager()
