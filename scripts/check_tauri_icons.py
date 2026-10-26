#!/usr/bin/env python3
"""Validate Tauri Linux bundle icons before spending minutes compiling Rust.

Regression guard for: "couldn't find a square icon to use as AppImage icon".
Only standard-library modules are used.
"""
from __future__ import annotations

import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "src-tauri"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def validate_icon(path: Path) -> tuple[int, int]:
    with path.open("rb") as icon:
        header = icon.read(26)
    if len(header) < 26 or not header.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path}: not a valid PNG header")
    if header[12:16] != b"IHDR":
        raise ValueError(f"{path}: PNG IHDR is missing")
    width, height = struct.unpack(">II", header[16:24])
    if width != height or width < 32:
        raise ValueError(f"{path}: expected square PNG >=32px; got {width}x{height}")
    return width, height


def main() -> int:
    config = json.loads((TAURI_DIR / "tauri.conf.json").read_text(encoding="utf-8"))
    icons = config.get("bundle", {}).get("icon")
    if not isinstance(icons, list) or not icons:
        raise ValueError("bundle.icon must list at least one square PNG for AppImage")
    good = []
    for icon in icons:
        if not isinstance(icon, str):
            raise ValueError("bundle.icon entries must be paths")
        path = TAURI_DIR / icon
        if path.suffix.lower() != ".png":
            continue  # Non-PNG icon types do not count for Linux AppImage.
        if not path.is_file():
            raise FileNotFoundError(f"Declared Tauri icon does not exist: {path}")
        good.append((path, validate_icon(path)))
    if not good:
        raise ValueError("AppImage needs at least one declared valid square PNG icon")
    for path, size in good:
        print(f"Verified AppImage icon: {path.relative_to(ROOT)} ({size[0]}x{size[1]})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"VTTRIG icon validation failed: {error}", file=sys.stderr)
        sys.exit(1)
