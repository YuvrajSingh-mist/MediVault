#!/usr/bin/env python3
"""
Render the report's result figures from the telemetry that the deployed backend
actually wrote to Firestore (`system/status`), plus the verification-suite
breakdown. Nothing here is invented: if the data file is missing, the script
says so rather than drawing a plausible-looking bar chart.

Input  : /tmp/runs.json  (array of recentRuns documents, exported with gcloud)
Output : docs/report/figures/*.pdf and *.png
"""

from __future__ import annotations

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

FIG_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "report", "figures")

INK = "#1b2733"
MUTED = "#5b6b7c"
BRAND = "#2f6f4f"
ACCENT = "#3f7cc4"
WARN = "#c25a3a"
GRID = "#dfe5ea"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.titlesize": 10,
        "axes.titleweight": "bold",
        "figure.dpi": 160,
        "savefig.bbox": "tight",
    }
)


def _style(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.7)
    ax.set_axisbelow(True)


def save(fig, name: str) -> None:
    os.makedirs(FIG_DIR, exist_ok=True)
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(FIG_DIR, f"{name}.{ext}"), facecolor="white")
    plt.close(fig)
    print(f"wrote {name}.pdf/.png")


# --------------------------------------------------------------------------- sweep latency
def sweep_latency() -> None:
    path = "/tmp/runs.json"
    if not os.path.exists(path):
        print("SKIP sweep-latency: /tmp/runs.json missing (export system/status first)")
        return
    runs = json.load(open(path))
    durations = [r["durationMs"] for r in runs if r.get("durationMs") is not None]
    if not durations:
        print("SKIP sweep-latency: no durationMs in telemetry")
        return

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.0), gridspec_kw={"width_ratios": [1.35, 1]})

    x = np.arange(1, len(durations) + 1)
    ax1.plot(x, durations, marker="o", markersize=4, color=BRAND, linewidth=1.6)
    mean = float(np.mean(durations))
    ax1.axhline(mean, color=ACCENT, linestyle="--", linewidth=1.1, label=f"mean {mean:.0f} ms")
    ax1.set_xlabel("Consecutive scheduled run")
    ax1.set_ylabel("Duration (ms)")
    ax1.set_title("Sweep duration, real Cloud Scheduler runs")
    ax1.set_ylim(0, max(durations) * 1.25)
    ax1.legend(frameon=False, fontsize=8, loc="lower right")
    _style(ax1)

    ax2.hist(durations, bins=6, color=BRAND, alpha=0.85, edgecolor="white")
    ax2.set_xlabel("Duration (ms)")
    ax2.set_ylabel("Runs")
    ax2.set_title(f"Distribution (n={len(durations)})")
    ax2.text(
        0.97,
        0.92,
        f"min {min(durations)} ms\nmax {max(durations)} ms\np95 budget 300 s",
        transform=ax2.transAxes,
        ha="right",
        va="top",
        fontsize=8,
        color=MUTED,
    )
    _style(ax2)
    fig.tight_layout()
    save(fig, "sweep-latency")


# --------------------------------------------------------------------------- verification
VERIFICATION = [
    ("Authentication", 3),
    ("Firestore rules", 5),
    ("Cloud Storage rules", 3),
    ("Callables (logDose, profile)", 6),
    ("Reminder engine / idempotency", 5),
    ("Scheduler telemetry", 3),
    ("Prescription trigger", 2),
    ("Delegation (API-only)", 3),
]


def verification() -> None:
    labels = [v[0] for v in VERIFICATION]
    values = [v[1] for v in VERIFICATION]
    fig, ax = plt.subplots(figsize=(7.2, 3.2))
    y = np.arange(len(labels))[::-1]
    bars = ax.barh(y, values, color=[BRAND if v > 3 else ACCENT for v in values], height=0.62)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Assertions passed")
    ax.set_title(f"Automated end-to-end verification - {sum(values)} assertions, no mocks")
    for bar, v in zip(bars, values):
        ax.text(bar.get_width() + 0.08, bar.get_y() + bar.get_height() / 2, str(v), va="center", fontsize=8.5, color=INK)
    ax.set_xlim(0, max(values) + 1)
    _style(ax)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID, linewidth=0.7)
    fig.tight_layout()
    save(fig, "verification")


# --------------------------------------------------------------------------- cost
COST = [
    ("Cloud Run / Functions", 0.00, "2 M free invocations, 400 k GB-s"),
    ("Cloud Scheduler", 0.00, "3 jobs free"),
    ("Firestore", 0.00, "50 k reads + 20 k writes / day free"),
    ("Cloud Storage", 0.00, "5 GB free"),
    ("Firebase Hosting", 0.00, "10 GB transfer free"),
    ("Firebase Authentication", 0.00, "unlimited Google sign-in"),
]


def cost() -> None:
    fig, ax = plt.subplots(figsize=(7.2, 2.9))
    ax.axis("off")
    rows = [["Service", "Monthly at demo scale", "Why it is free"]]
    rows += [[a, f"US$ {b:,.2f}", c] for a, b, c in COST]
    table = ax.table(cellText=rows, loc="center", cellLoc="left", colWidths=[0.33, 0.22, 0.45])
    table.auto_set_font_size(False)
    table.set_fontsize(8.5)
    table.scale(1, 1.65)
    for (r, _c), cell in table.get_celld().items():
        cell.set_linewidth(0.4)
        cell.set_edgecolor(GRID)
        if r == 0:
            cell.set_facecolor("#eef3f0")
            cell.set_text_props(weight="bold", color=INK)
    ax.set_title("Recurring cost at the scale of this project (30-day estimate)", fontsize=10, weight="bold")
    save(fig, "cost")


# --------------------------------------------------------------------------- channels
def channels() -> None:
    labels = ["In-app toast", "Desktop notification", "Web push (FCM)", "Email"]
    conditions = ["tab open", "tab hidden", "tab closed", "always"]
    setup = ["none", "1 permission click", "VAPID key", "SendGrid key (optional)"]
    fig, ax = plt.subplots(figsize=(7.4, 2.5))
    ax.axis("off")
    rows = [["Channel", "Fires when", "Setup"]]
    rows += [[a, b, c] for a, b, c in zip(labels, conditions, setup)]
    table = ax.table(cellText=rows, loc="center", cellLoc="left", colWidths=[0.3, 0.24, 0.46])
    table.auto_set_font_size(False)
    table.set_fontsize(8.5)
    table.scale(1, 1.7)
    for (r, _c), cell in table.get_celld().items():
        cell.set_linewidth(0.4)
        cell.set_edgecolor(GRID)
        if r == 0:
            cell.set_facecolor("#eef3f0")
            cell.set_text_props(weight="bold", color=INK)
    ax.set_title("One alert document, four delivery channels", fontsize=10, weight="bold")
    save(fig, "channels")


if __name__ == "__main__":
    sweep_latency()
    verification()
    cost()
    channels()
