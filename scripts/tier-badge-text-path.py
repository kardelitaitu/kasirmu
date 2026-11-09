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


def main(argv=None, root=None) -> int:
    """r207: argv parameterized, the r166..r206 contract in its no-checkout
    form. This tool's evidence is the caller's font file and geometry on
    argv -- it reads no repository path -- so there is no root to redirect;
    root is accepted by signature and ignored. The load-bearing half HERE
    is explicit argv plus a real usage refusal: an unpack of sys.argv[1:6]
    used to die with a bare ValueError/IndexError instead of naming the
    five arguments it wants."""
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 5:
        print("usage: tier-badge-text-path.py <font.ttf> <label> "
              "<fontSize> <tracking> <weight> -- got %d argument(s)"
              % len(args), file=sys.stderr)
        return 2
    font_path, label, font_size, tracking, weight = args
    try:
        font_size = float(font_size)
        tracking = float(tracking)
        weight = int(weight)
    except ValueError:
        print("usage: fontSize and tracking must be numbers, weight an int",
              file=sys.stderr)
        return 2

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


def self_test() -> int:
    """r207: main() graded through explicit argv against a fixture font BUILT
    with fontTools (glyph A, advance 600, upem 1000) -- no system font, no
    checkout file, no network."""
    import contextlib as _ctx
    import io as _io
    import json as _json
    import tempfile as _tempfile
    from pathlib import Path as _Path
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    shell = 0
    with _tempfile.TemporaryDirectory() as tdp:
        # build the fixture font: one glyph, a triangle, advance 600
        pen = TTGlyphPen(None)
        pen.moveTo((50, 0)); pen.lineTo((550, 0)); pen.lineTo((300, 700))
        pen.closePath()
        fb = FontBuilder(1000, isTTF=True)
        penB = TTGlyphPen(None)
        penB.moveTo((50, 0)); penB.lineTo((450, 0)); penB.lineTo((250, 500))
        penB.closePath()
        nd = TTGlyphPen(None); nd.glyph()
        fb.setupGylfOrder = None
        fb.setupGlyphOrder([".notdef", "A", "B"])
        fb.setupCharacterMap({65: "A", 66: "B"})
        fb.setupGlyf({".notdef": nd.glyph(), "A": pen.glyph(), "B": penB.glyph()})
        fb.setupHorizontalMetrics({"A": (600, 0), "B": (500, 0), ".notdef": (600, 0)})
        fb.setupHorizontalHeader(ascent=800, descent=-200)
        fb.setupNameTable({"familyName": "Probe", "styleName": "Regular"})
        fb.setupOS2()
        fb.setupPost()
        font_path = str(_Path(tdp) / "probe.ttf")
        fb.save(font_path)
        def run(*argv):
            out, err = _io.StringIO(), _io.StringIO()
            try:
                with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                    rc = main(argv=list(argv))
            except SystemExit as se:
                return se.code, out.getvalue() + err.getvalue()
            return rc, out.getvalue() + err.getvalue()
        shell += 1
        rc, text = run(font_path, "A", "12", "0", "400")
        if rc != 0:
            print("  x a valid call must render rc 0 (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        obj = _json.loads(text)
        if not obj.get("d") or obj.get("upem") != 1000:
            print("  x the path must carry ink and the real upem (obj=%r)" % obj,
                  file=sys.stderr)
            return 1
        # advance = 600 * 12 / 1000 = 7.2; tracking 0, final space not ink
        if abs(obj.get("advance", -1) - 7.2) > 0.01:
            print("  x advance must be 7.2 for advance-600 at 12pt (obj=%r)" % obj,
                  file=sys.stderr)
            return 1
        # tracking widens BETWEEN glyphs only: a single glyph's trailing
        # tracking is exactly the final letter-space that is not ink
        shell += 1
        rc, text = run(font_path, "A", "12", "2", "400")
        obj2 = _json.loads(text)
        if abs(obj2.get("advance", -1) - 7.2) > 0.01:
            print("  x one glyph's trailing tracking must not count as ink (obj=%r)" % obj2,
                  file=sys.stderr)
            return 1
        shell += 1
        rc, text = run(font_path, "AB", "12", "2", "400")
        obj3 = _json.loads(text)
        # 600*0.012 + 2 + 500*0.012 = 7.2 + 2 + 6.0 = 15.2, minus the final
        # letter-space 2 = 15.2 (the B glyph carries no trailing tracking)
        if abs(obj3.get("advance", -1) - 15.2) > 0.01:
            print("  x the AB advance must be 7.2 + 2 + 6.0 = 15.2 (obj=%r)" % obj3,
                  file=sys.stderr)
            return 1
        shell += 1
        rc, text = run(font_path, "Ω", "12", "0", "400")
        if rc is None or "font has no glyph" not in str(rc) + text:
            print("  x a missing glyph must refuse naming it (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        rc, text = run(font_path, "A", "12", "0")
        if rc != 2 or "got 4 argument(s)" not in text:
            print("  x a short argv must refuse rc 2 with the count (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        rc, text = run(font_path, "A", "big", "0", "400")
        if rc != 2 or "must be numbers" not in text:
            print("  x a non-numeric size must refuse rc 2 (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1

    print("SELF-TEST OK (%d cases over a fontTools-built fixture font, "
          "no checkout file read)" % shell)
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv[1:] else main())
