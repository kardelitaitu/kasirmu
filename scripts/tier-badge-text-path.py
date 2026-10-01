#!/usr/bin/env python3
"""Convert a badge label into an SVG path, so the artwork carries no font
dependency.

Reads a font path, label and geometry on argv and prints one JSON object with
the centred-agnostic path `d` plus the exact advance width. The generator
embeds the result in its SVGs, which makes every badge render identically on a
machine that has no Inter installed at all.

Usage:
    python scripts/tier-badge-text-path.py <font.ttf> <label> <fontSize> <tracking> <weight>
"""

import json
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform


def main() -> int:
    font_path, label, font_size, tracking, weight = sys.argv[1:6]
    font_size = float(font_size)
    tracking = float(tracking)
    weight = int(weight)

    font = TTFont(font_path)
    if "fvar" in font:
        from fontTools.varLib.instancer import instantiateVariableFont

        instantiateVariableFont(font, {"wght": weight}, inplace=True)

    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    scale = font_size / upem

    paths = []
    pen_x = 0.0
    for ch in label:
        glyph_name = cmap.get(ord(ch))
        if glyph_name is None:
            raise SystemExit(f"font has no glyph for {ch!r}")
        # Flip Y: font outlines grow upward, SVG grows downward.
        transform = Transform(scale, 0, 0, -scale, pen_x, 0)
        pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.2f}")
        glyph_set[glyph_name].draw(TransformPen(pen, transform))
        d = pen.getCommands()
        if d:
            paths.append(d)
        pen_x += hmtx[glyph_name][0] * scale + tracking

    # The final letter-space is not ink.
    advance = pen_x - tracking
    print(json.dumps({
        "d": " ".join(paths),
        "advance": round(advance, 3),
        "upem": upem,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
