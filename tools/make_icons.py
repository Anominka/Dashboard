"""Draws the app icons (a gauge on the Night background) into ../icons. Run with the project's Python:

    .venv\\Scripts\\python.exe code\\web\\tools\\make_icons.py

The artwork stays inside the middle 70% so the phone can crop the icon to a circle or rounded square.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPen

BACKGROUND = "#0D1117"  # Night theme, see theme.css
TRACK = "#2D3540"
ACCENT = "#60A5FA"
TEXT = "#E8EDF3"

SIZES = {"icon-180.png": 180, "icon-192.png": 192, "icon-512.png": 512}


def draw(size):
    image = QImage(size, size, QImage.Format_RGB32)
    image.fill(QColor(BACKGROUND))
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing)

    center = QPointF(size / 2, size / 2)
    radius = size * 0.30
    ring = QRectF(center.x() - radius, center.y() - radius, radius * 2, radius * 2)
    width = size * 0.075

    # a 270 degree gauge arc, open at the bottom: the full track, then the accent part of it
    start, span = 225 * 16, -270 * 16
    track_pen = QPen(QColor(TRACK), width, Qt.SolidLine, Qt.RoundCap)
    painter.setPen(track_pen)
    painter.drawArc(ring, start, span)
    painter.setPen(QPen(QColor(ACCENT), width, Qt.SolidLine, Qt.RoundCap))
    painter.drawArc(ring, start, int(span * 0.68))

    # needle from the center, pointing at the end of the accent part
    import math

    angle = math.radians(225 - 270 * 0.68)
    tip = QPointF(center.x() + math.cos(angle) * radius * 0.78, center.y() - math.sin(angle) * radius * 0.78)
    painter.setPen(QPen(QColor(TEXT), size * 0.04, Qt.SolidLine, Qt.RoundCap))
    painter.drawLine(center, tip)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor(TEXT))
    hub = size * 0.045
    painter.drawEllipse(center, hub, hub)

    painter.end()
    return image


def main():
    app = QGuiApplication(sys.argv)  # noqa: F841 - Qt needs it alive while painting
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for name, size in SIZES.items():
        draw(size).save(str(out / name))
        print("wrote", out / name)


if __name__ == "__main__":
    main()
