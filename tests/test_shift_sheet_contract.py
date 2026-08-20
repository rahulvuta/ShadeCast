"""Shift sheet PDF is client-side (web); this documents required assess fields."""

from __future__ import annotations

REQUIRED_SHIFT_SHEET_KEYS = {
    "location",
    "days",
    "schedule",
    "shift_windows",
    "actions",
    "sources",
    "disclaimer",
    "share_url",
}


def test_shift_sheet_field_checklist():
    """Supervisor sheet content checklist — keep in sync with web/src/lib/shiftSheet.ts."""
    assert "days" in REQUIRED_SHIFT_SHEET_KEYS
    assert "shift_windows" in REQUIRED_SHIFT_SHEET_KEYS
    assert "actions" in REQUIRED_SHIFT_SHEET_KEYS
    assert "share_url" in REQUIRED_SHIFT_SHEET_KEYS
    assert len(REQUIRED_SHIFT_SHEET_KEYS) >= 8
