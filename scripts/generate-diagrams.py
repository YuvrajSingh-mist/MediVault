#!/usr/bin/env python3
"""
Draw the MediVault diagrams on an Excalidraw canvas.

The layout is planned here as data (boxes, zones, connectors), measured against
Helvetica metrics so no label is ever wider than the shape that holds it, then
pushed to a local Excalidraw canvas server. That server renders the result
headless, so the script can check its own work before committing anything.

Requires the canvas toolkit (MIT, https://github.com/yctimlin/mcp_excalidraw):

    npx -y mcp-excalidraw-server@2.1.2 start      # once, then leave it running
    python3 scripts/generate-diagrams.py

Environment:
    EXPRESS_SERVER_URL     canvas server (default http://127.0.0.1:3931)
    EXCALIDRAW_CLI         CLI entry point (default: npx -y mcp-excalidraw-server@2.1.2)
    EXCALIDRAW_EXPORT_DIR  writable root for exports (default: docs/architecture)

Outputs, per diagram: .excalidraw (editable), .svg, .png, .pdf (for the report).
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import ImageFont

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = Path(os.environ.get("EXCALIDRAW_EXPORT_DIR", REPO / "docs" / "architecture"))
CANVAS_URL = os.environ.get("EXPRESS_SERVER_URL", "http://127.0.0.1:3931")
CLI = shlex.split(os.environ.get("EXCALIDRAW_CLI", "npx -y mcp-excalidraw-server@2.1.2"))

# Helvetica metrics, used only to size shapes. Excalidraw renders fontFamily 2
# with Liberation Sans, which shares Helvetica's widths, so these are accurate
# to within a pixel.
_FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
_font_path = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)
_font_cache: dict[int, ImageFont.FreeTypeFont] = {}
LINE_HEIGHT = 1.25


def text_width(text: str, size: int) -> float:
    if _font_path is None:
        return len(text) * size * 0.53
    if size not in _font_cache:
        _font_cache[size] = ImageFont.truetype(_font_path, size)
    return _font_cache[size].getlength(text)


# --------------------------------------------------------------------------
# palette, mirroring the Excalidraw design guide so the report figures and the
# .excalidraw files agree with each other
# --------------------------------------------------------------------------

INK = "#1e1e1e"
MUTED = "#868e96"
RULE = "#ced4da"

PALETTE = {
    "client": ("#e7f5ff", "#1971c2"),
    "edge": ("#a5d8ff", "#1971c2"),
    "app": ("#a5d8ff", "#1971c2"),
    "compute": ("#d0bfff", "#7048e8"),
    "data": ("#b2f2bb", "#2f9e44"),
    "file": ("#ffec99", "#e8590c"),
    "channel": ("#ffd8a8", "#e8590c"),
    "note": ("#fff9db", "#f08c00"),
    "neutral": ("#ffffff", "#495057"),
}


class Diagram:
    """Collects elements and keeps the little invariants that matter."""

    def __init__(self, name: str, width: int):
        self.name = name
        self.width = width
        self.elements: list[dict] = []
        self._ids: set[str] = set()
        self.zones: set[str] = set()

    # -- primitives ---------------------------------------------------------

    def _claim(self, eid: str) -> str:
        if eid in self._ids:
            raise ValueError(f"{self.name}: duplicate id {eid!r}")
        self._ids.add(eid)
        return eid

    def text(self, eid, x, y, body, size=15, color=INK):
        lines = body.split("\n")
        w = max(text_width(line, size) for line in lines) + 4
        h = len(lines) * size * LINE_HEIGHT
        el = {
            "id": self._claim(eid),
            "type": "text",
            "x": round(x),
            "y": round(y),
            "width": round(w),
            "height": round(h),
            "text": body,
            "fontSize": size,
            "fontFamily": "helvetica",
            "strokeColor": color,
            "textAlign": "left",
        }
        self.elements.append(el)
        return el

    def box(
        self,
        eid,
        cx,
        top,
        body,
        *,
        tone="neutral",
        size=17,
        width=None,
        height=None,
        pad_x=28,
        pad_y=22,
        shape="rectangle",
        dashed=False,
        min_width=150,
    ):
        """A shape centred on cx whose label fits with room to spare."""
        fill, stroke = PALETTE[tone]
        lines = body.split("\n")
        text_w = max(text_width(line, size) for line in lines)
        text_h = len(lines) * size * LINE_HEIGHT
        w = round(width or max(min_width, text_w + pad_x * 2))
        h = round(height or max(62, text_h + pad_y * 2))
        el = {
            "id": self._claim(eid),
            "type": shape,
            "x": round(cx - w / 2),
            "y": round(top),
            "width": w,
            "height": h,
            "text": body,
            "fontSize": size,
            "fontFamily": "helvetica",
            "fillStyle": "solid",
            "backgroundColor": fill,
            "strokeColor": stroke,
            "strokeWidth": 1.5,
            "roundness": {"type": 3},
        }
        if dashed:
            el["strokeStyle"] = "dashed"
        self.elements.append(el)
        return el

    def zone(self, eid, x, y, w, h, label=None, *, dashed=True, tone="#f8f9fa"):
        el = {
            "id": self._claim(eid),
            "type": "rectangle",
            "x": round(x),
            "y": round(y),
            "width": round(w),
            "height": round(h),
            "backgroundColor": tone,
            "fillStyle": "solid",
            "strokeColor": RULE,
            "strokeWidth": 1,
            "roundness": {"type": 3},
        }
        if dashed:
            el["strokeStyle"] = "dashed"
        self.elements.append(el)
        self.zones.add(el["id"])
        if label:
            # Free-standing text, never a label: a bound label would sit in the
            # middle of the zone and collide with the children.
            self.text(f"{eid}-label", x + 20, y + 12, label, size=15, color=MUTED)
        return el

    def arrow(
        self,
        eid,
        source=None,
        target=None,
        *,
        label=None,
        dashed=False,
        points=None,
        start=None,
        both=False,
        color="#495057",
        label_size=14,
    ):
        if points is not None:
            x, y = points[0]
            el = {
                "id": self._claim(eid),
                "type": "arrow",
                "x": round(x),
                "y": round(y),
                "width": 0,
                "height": 0,
                "points": [[round(px - x), round(py - y)] for px, py in points],
                "strokeColor": color,
                "strokeWidth": 1.6,
                "roundness": None,
                "endArrowhead": "arrow",
                "startArrowhead": "arrow" if both else None,
            }
        else:
            el = {
                "id": self._claim(eid),
                "type": "arrow",
                "x": 0,
                "y": 0,
                "startElementId": source,
                "endElementId": target,
                "strokeColor": color,
                "strokeWidth": 1.6,
                "endArrowhead": "arrow",
                "startArrowhead": "arrow" if both else None,
            }
        if dashed:
            el["strokeStyle"] = "dashed"
        if label:
            el["text"] = label
            el["fontSize"] = label_size
            el["fontFamily"] = "helvetica"
        self.elements.append(el)
        return el

    # -- output -------------------------------------------------------------

    def payload(self) -> str:
        return json.dumps(self.elements)


# --------------------------------------------------------------------------
# diagram 1: system architecture
# --------------------------------------------------------------------------


def architecture() -> Diagram:
    d = Diagram("system-architecture", 1240)

    d.text("title", 40, 34, "MediVault: serverless architecture on Google Cloud Platform", size=27)
    d.text(
        "subtitle",
        40,
        88,
        "Every tier is a managed service. The only long-lived component is the browser.",
        size=15,
        color="#495057",
    )

    spine = 620

    d.box("patient", spine, 150, "Patient", tone="client", size=19, shape="ellipse", width=230, height=90)
    d.box("hosting", spine, 296, "Firebase Hosting", tone="edge", size=19, width=280, height=82)
    d.text("hosting-note", 782, 300, "global CDN, HTTPS\nimmutable assets", size=14, color=MUTED)

    d.box("spa", spine, 450, "React 18 SPA", tone="app", size=19, width=300, height=94)

    d.box("auth", 1070, 450, "Firebase Auth", tone="app", size=19, width=260, height=94)

    d.zone("computezone", 100, 640, 1120, 240, "Compute tier")
    d.box("scheduler", 250, 704, "Cloud Scheduler", tone="compute", size=17)
    d.text("scheduler-note", 150, 792, "cron: every 5 minutes", size=14, color=MUTED)

    d.box("functions", 610, 696, "Cloud Functions\n2nd gen, Cloud Run, Node.js 22", tone="compute", size=17)

    d.box("fanout", 1020, 696, "FCM + SendGrid\npush and email", tone="channel", size=17)

    d.box("firestore", 620, 1010, "Cloud Firestore\nusers, medicines, doses", tone="data", size=17)
    d.box("storage", 210, 1010, "Cloud Storage\nprivate bucket", tone="file", size=17)
    d.box("logging", 1050, 1010, "Cloud Logging\nstructured JSON", tone="neutral", size=17)

    d.arrow("a-patient-hosting", "patient", "hosting")
    d.arrow("a-hosting-spa", "hosting", "spa")
    d.arrow("a-hosting-auth", "hosting", "auth")
    d.arrow("a-spa-auth", "spa", "auth", label="ID token", both=True)
    d.arrow("a-spa-functions", "spa", "functions", label="callables")
    d.arrow("a-scheduler-functions", "scheduler", "functions", label="invokes")
    d.arrow("a-functions-fanout", "functions", "fanout", label="fan-out")
    d.arrow("a-functions-firestore", "functions", "firestore", label="read + write")
    d.arrow("a-storage-functions", "storage", "functions", label="upload trigger", dashed=True)
    d.arrow("a-functions-logging", "functions", "logging", label="structured logs")

    # The live read-only subscription leaves Firestore from below, runs along
    # the bottom and up the left margin, so it crosses no other element.
    d.arrow(
        "a-firestore-spa",
        points=[(620, 1108), (620, 1150), (60, 1150), (60, 470), (470, 470)],
        dashed=True,
    )
    d.text("live-read-note", 68, 486, "live read", size=14, color=MUTED)

    d.text(
        "footer",
        40,
        1184,
        "Firestore and the functions run in asia-south1; the sweep runs every five minutes.",
        size=14,
        color=MUTED,
    )
    return d


# --------------------------------------------------------------------------
# diagram 2: reminder sweep
# --------------------------------------------------------------------------


def reminder_sweep() -> Diagram:
    d = Diagram("reminder-sweep", 1180)

    d.text("title", 40, 30, "One sweep of the reminder engine", size=27)
    d.text(
        "subtitle",
        40,
        84,
        "Alert identifiers are fixed in advance, so a scheduler retry cannot send the same alert twice.",
        size=15,
        color="#495057",
    )

    spine = 520

    d.box("scheduler", spine, 140, "Cloud Scheduler\ncron: every 5 minutes", tone="compute", size=17)
    d.box("function", spine, 290, "sweepReminders\nCloud Function, 2nd gen", tone="compute", size=17)

    d.zone("loadzone", 60, 430, 920, 235, "One read per collection per run")
    d.box("load-meds", 240, 490, "Active medicines\nat most 500", tone="data", size=16)
    d.box("load-appts", 520, 490, "Appointments\ndue within 24 hours", tone="data", size=16)
    d.box("load-profiles", 800, 490, "Profiles\ntimezone and preferences", tone="data", size=16)

    d.box(
        "evaluate",
        spine,
        720,
        "Evaluate four predicates\nin the owner's timezone\n\n"
        "Dose due in this window\nStock at the refill threshold\n"
        "Expiry at 30, 14, 7, 3, 1 or 0 days\nAppointment within 24 hours",
        tone="note",
        size=15,
    )

    d.box("exists", spine, 940, "Reminder already\nexists?", tone="neutral", size=17, shape="diamond", width=320, height=170)
    d.box("noop", 940, 1000, "Nothing written\nthe create fails, treated\nas success", tone="neutral", size=14, dashed=True)

    d.box("raise", spine, 1160, "Create reminders/{id}\ntransactional create-if-absent", tone="compute", size=16)

    d.zone("channelzone", 40, 1300, 1080, 190, "Fan-out, recorded on the alert document")
    d.box("ch-inapp", 190, 1360, "In-app toast\nlive snapshot listener", tone="channel", size=14)
    d.box("ch-desktop", 450, 1360, "Desktop notice\nNotifications API", tone="channel", size=14)
    d.box("ch-push", 710, 1360, "Web push\nFCM multicast", tone="channel", size=14)
    d.box("ch-mail", 970, 1360, "Email\nSendGrid or outbox", tone="channel", size=14)

    d.box("telemetry", spine, 1560, "Write the run summary to system/status", tone="data", size=15)

    d.arrow("a-sched-fn", "scheduler", "function")
    d.arrow("a-fn-loads", "function", "loadzone", dashed=True)
    d.arrow("a-loads-eval", "load-meds", "evaluate")
    d.arrow("a-loads-eval2", "load-appts", "evaluate")
    d.arrow("a-loads-eval3", "load-profiles", "evaluate")
    d.arrow("a-eval-exists", "evaluate", "exists")
    # Vertical arrows get no bound label: Excalidraw centres a bound label on the
    # line itself, which strikes through the word. These sit beside it instead.
    d.arrow("a-exists-noop", "exists", "noop")
    d.text("label-no", 762, 992, "no", size=14, color=MUTED)
    d.arrow("a-exists-raise", "exists", "raise")
    d.text("label-yes", spine + 16, 1122, "yes", size=14, color=MUTED)
    for channel in ("ch-inapp", "ch-desktop", "ch-push", "ch-mail"):
        d.arrow(f"a-raise-{channel}", "raise", channel)
    # The run summary is written even when nothing is fanned out, so this
    # connector goes around the channel zone rather than through it.
    d.arrow(
        "a-raise-tele",
        points=[(664, 1200), (1150, 1200), (1150, 1590), (700, 1590)],
        dashed=True,
    )
    d.text("telemetry-note", 706, 1544, "written on every run, including no-op runs", size=14, color=MUTED)

    return d


# --------------------------------------------------------------------------
# diagram 3: data model
# --------------------------------------------------------------------------


def data_model() -> Diagram:
    d = Diagram("data-model", 1180)

    d.text("title", 40, 30, "Firestore collections and who may write them", size=27)
    d.text(
        "subtitle",
        40,
        84,
        "Every document carries an owning userId, which turns each security rule into one equality check.",
        size=15,
        color="#495057",
    )

    d.box(
        "users",
        560,
        150,
        "users/{uid}\n\ndisplayName, email\ntimezone, prefs\nfcmTokens[]",
        tone="data",
        size=15,
        width=330,
    )

    d.box(
        "medicines",
        200,
        430,
        "medicines/{id}\n\nname, dosage, form\ntimes[], remainingTablets\nrefillThreshold, expiryDate",
        tone="data",
        size=15,
        width=340,
    )
    d.box(
        "appointments",
        560,
        430,
        "appointments/{id}\n\ndoctorName, speciality\ndate, location, status",
        tone="data",
        size=15,
        width=340,
    )
    d.box(
        "reminders",
        920,
        430,
        "reminders/{id}\n\ntype, title, body\ndedupeKey, channels[]\nread, readAt",
        tone="file",
        size=15,
        width=340,
    )

    d.box(
        "doselogs",
        200,
        720,
        "doseLogs/{medId_date_hhmm}\n\nstatus: taken | skipped\nloggedBy, loggedAt",
        tone="data",
        size=15,
        width=340,
    )
    d.box(
        "outbox",
        920,
        720,
        "mailOutbox/{id}\n\ncomposed message\nstatus, providerError",
        tone="file",
        size=15,
        width=340,
    )
    d.box(
        "status",
        560,
        720,
        "system/status\n\nlastRun, recentRuns\nschedule strings",
        tone="neutral",
        size=15,
        width=300,
    )

    d.arrow("r-users-meds", "users", "medicines", label="1 : N")
    d.arrow("r-users-appts", "users", "appointments", label="1 : N")
    d.arrow("r-users-reminders", "users", "reminders", label="1 : N")
    d.arrow("r-meds-logs", "medicines", "doselogs", label="1 : N")
    d.arrow("r-rem-outbox", "reminders", "outbox", label="composed from", dashed=True)

    # Legend, built from the same fills the boxes use.
    legend_y = 910
    d.text("legend-title", 60, legend_y, "Written by", size=14, color=MUTED)
    d.box("legend-owner", 175, legend_y - 3, "", tone="data", width=18, height=18, pad_x=0, pad_y=0)
    d.text("legend-owner-label", 200, legend_y, "the signed-in owner", size=14, color=INK)
    d.box("legend-engine", 420, legend_y - 3, "", tone="file", width=18, height=18, pad_x=0, pad_y=0)
    d.text("legend-engine-label", 445, legend_y, "Cloud Functions through the Admin SDK", size=14, color=INK)
    d.text(
        "status-note",
        60,
        950,
        "system/status is a single document, written only by the sweep.",
        size=14,
        color=MUTED,
    )

    return d


# --------------------------------------------------------------------------
# canvas plumbing
# --------------------------------------------------------------------------


def cli(*args: str, stdin: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "EXPRESS_SERVER_URL": CANVAS_URL,
        "EXCALIDRAW_NO_AUTOSTART": "1",
        "EXCALIDRAW_EXPORT_DIR": str(OUT_DIR),
    }
    return subprocess.run(
        [*CLI, *args],
        input=stdin,
        text=True,
        capture_output=True,
        env=env,
        check=check,
    )


def canvas_is_up() -> bool:
    try:
        with urllib.request.urlopen(f"{CANVAS_URL}/health", timeout=2) as resp:
            return json.load(resp).get("status") == "healthy"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return False


def ensure_canvas() -> None:
    if canvas_is_up():
        return
    port = urllib.parse.urlparse(CANVAS_URL).port or 3931
    env = {
        **os.environ,
        "EXPRESS_SERVER_URL": CANVAS_URL,
        "HOST": "127.0.0.1",
        "PORT": str(port),
    }
    subprocess.run([*CLI, "start"], env=env, check=True, capture_output=True, text=True)
    if not canvas_is_up():
        sys.exit(f"canvas server did not come up at {CANVAS_URL}")


def audit_layout(diagram: Diagram) -> list[str]:
    """Cheap geometry check: shapes must not overlap, labels must fit."""
    problems: list[str] = []
    shapes = [e for e in diagram.elements if e["type"] in ("rectangle", "ellipse", "diamond")]
    for i, a in enumerate(shapes):
        for b in shapes[i + 1 :]:
            if a["id"] in diagram.zones or b["id"] in diagram.zones:
                continue  # zones are frames; boxes are meant to sit inside them
            ax2, ay2 = a["x"] + a["width"], a["y"] + a["height"]
            bx2, by2 = b["x"] + b["width"], b["y"] + b["height"]
            ox = min(ax2, bx2) - max(a["x"], b["x"])
            oy = min(ay2, by2) - max(a["y"], b["y"])
            if ox > 2 and oy > 2:
                problems.append(f"{a['id']} overlaps {b['id']} by {ox}x{oy}px")
    for e in diagram.elements:
        label = e.get("text")
        if not label or e["type"] in ("text", "arrow"):
            continue
        widest = max(text_width(line, e["fontSize"]) for line in label.split("\n"))
        if widest > e["width"] - 12:
            problems.append(
                f"{e['id']}: label needs {widest:.0f}px, shape is {e['width']}px wide"
            )
    return problems



def _segments(elem: dict) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Absolute polyline segments for an exported arrow."""
    pts = elem.get("points") or [[0, 0], [0, 0]]
    ox, oy = elem["x"], elem["y"]
    absolute = [(ox + px, oy + py) for px, py in pts]
    return list(zip(absolute, absolute[1:]))


def _segment_hits_box(seg, box, margin=4.0) -> bool:
    (x1, y1), (x2, y2) = seg
    bx1, by1 = box["x"] - margin, box["y"] - margin
    bx2, by2 = box["x"] + box["width"] + margin, box["y"] + box["height"] + margin
    # Liang-Barsky clipping: does the segment intersect the padded rectangle?
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - bx1), (dx, bx2 - x1), (-dy, y1 - by1), (dy, by2 - y1)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def audit_export(path: Path, zones: set[str]) -> list[str]:
    """Re-read the committed scene and check the geometry the renderer used."""
    scene = json.loads(Path(path).read_text())
    elements = scene["elements"]
    by_id = {e["id"]: e for e in elements}
    boxes = [
        e
        for e in elements
        if e["type"] in ("rectangle", "ellipse", "diamond") and e["id"] not in zones
    ]
    problems: list[str] = []

    for elem in elements:
        if elem["type"] != "arrow":
            continue
        ends = {
            (elem.get("startBinding") or {}).get("elementId"),
            (elem.get("endBinding") or {}).get("elementId"),
        }
        absolute = [(elem["x"] + px, elem["y"] + py) for px, py in (elem.get("points") or [[0, 0]])]
        endpoints = [absolute[0], absolute[-1]]
        for box in boxes:
            if box["id"] in ends:
                continue
            # A hand-routed arrow legally terminates on a shape edge.
            if any(
                box["x"] - 12 <= ex <= box["x"] + box["width"] + 12
                and box["y"] - 12 <= ey <= box["y"] + box["height"] + 12
                for ex, ey in endpoints
            ):
                continue
            if any(_segment_hits_box(seg, box) for seg in _segments(elem)):
                problems.append(f"arrow {elem['id']} crosses {box['id']}")

    # Labels and free-standing text must not sit on top of a shape.
    for elem in elements:
        if elem["type"] != "text":
            continue
        container = elem.get("containerId")
        own = by_id.get(container) if container else None
        for box in boxes:
            if own is not None and box["id"] == container:
                continue
            if box["id"] == elem["id"]:
                continue
            overlap_x = min(elem["x"] + elem["width"], box["x"] + box["width"]) - max(
                elem["x"], box["x"]
            )
            overlap_y = min(elem["y"] + elem["height"], box["y"] + box["height"]) - max(
                elem["y"], box["y"]
            )
            if overlap_x > 4 and overlap_y > 4:
                problems.append(f"text {elem['id']} overlaps {box['id']}")
    return problems


def emit(diagram: Diagram) -> list[str]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = OUT_DIR / diagram.name

    cli("clear", "--yes", check=False)
    cli("add", "-", stdin=diagram.payload())

    for args in (
        ("screenshot", "--out", f"{base}.png", "--scale", "3", "--padding", "28"),
        ("screenshot", "--format", "svg", "--out", f"{base}.svg"),
        ("export", "--out", f"{base}.excalidraw"),
    ):
        result = cli(*args, check=False)
        if result.returncode != 0:
            sys.exit(f"{diagram.name}: {' '.join(args)} failed\n{result.stderr.strip()}")

    strip_embedded_fonts(Path(f"{base}.svg"))
    problems = audit_export(Path(f"{base}.excalidraw"), diagram.zones)
    write_pdf(base)
    print(f"  {diagram.name}: {len(diagram.elements)} elements -> .excalidraw .svg .png .pdf")
    return problems


_FONT_STYLE = re.compile(r'<style class="style-fonts">.*?</style>', re.DOTALL)


def strip_embedded_fonts(path: Path) -> None:
    """Drop Excalidraw's base64 @font-face block from an exported SVG.

    The block embeds a whole TTF as base64, which adds about 300 kB to every
    diagram and, more importantly, makes the file look like it contains binary
    secrets: long base64 runs match naive credential scanners (GitGuardian
    flagged the Liberation Sans blob as a Twilio account SID). The layout is
    computed from font metrics before export, so removing the face only changes
    the fallback font a viewer picks, not the geometry.
    """
    svg = path.read_text(encoding="utf-8")
    cleaned, count = _FONT_STYLE.subn(
        '<style class="style-fonts">text{font-family:"Liberation Sans",Helvetica,Arial,sans-serif}</style>',
        svg,
        count=1,
    )
    if count == 0 or cleaned == svg:
        return
    path.write_text(cleaned, encoding="utf-8")


def write_pdf(base: Path) -> None:
    """Place the rendered PNG on a page sized for the report (16 cm wide)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    image = Image.open(f"{base}.png")
    width_px, height_px = image.size
    width_in = 16 / 2.54
    height_in = width_in * height_px / width_px
    figure = plt.figure(figsize=(width_in, height_in))
    axes = figure.add_axes((0, 0, 1, 1))
    axes.axis("off")
    axes.imshow(image)
    figure.savefig(f"{base}.pdf", dpi=min(400, width_px / width_in))
    plt.close(figure)


def main() -> None:
    ensure_canvas()
    if not OUT_DIR.exists():
        sys.exit(f"export dir {OUT_DIR} does not exist")

    failed = False
    for builder in (architecture, reminder_sweep, data_model):
        diagram = builder()
        problems = audit_layout(diagram)
        if problems:
            failed = True
            print(f"{diagram.name}: {len(problems)} layout problem(s)")
            for problem in problems:
                print(f"  - {problem}")
        problems += emit(diagram)
        if problems:
            failed = True
            print(f"{diagram.name}: {len(problems)} post-render problem(s)")
            for problem in problems:
                print(f"  - {problem}")

    if failed:
        sys.exit("layout audit failed; fix the geometry above")


if __name__ == "__main__":
    main()
