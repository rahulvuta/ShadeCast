"""AA contrast checks for Okabe–Ito verdict palette (mirrors web/src/design/tokens.ts)."""

from __future__ import annotations


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r = int(h[0:2], 16) / 255
    g = int(h[2:4], 16) / 255
    b = int(h[4:6], 16) / 255
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast_ratio(a: str, b: str) -> float:
    l1 = relative_luminance(a)
    l2 = relative_luminance(b)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# Must stay in sync with web/src/design/tokens.ts verdictPalette
VERDICT_TEXT_ON_BASE = {
    "GO": ("#FFFFFF", "#009E73"),
    "CAUTION": ("#111111", "#E69F00"),
    "RESTRICT": ("#FFFFFF", "#D55E00"),
    "STOP": ("#FFFFFF", "#0072B2"),
    "UNUSABLE": ("#FFFFFF", "#5A6570"),
}


def test_verdict_palette_meets_aa_for_large_text() -> None:
    """WCAG AA for large text is 3:1; display verdict type qualifies."""
    for name, (fg, bg) in VERDICT_TEXT_ON_BASE.items():
        ratio = contrast_ratio(fg, bg)
        assert ratio >= 3.0, f"{name}: {fg} on {bg} = {ratio:.2f} < 3"
