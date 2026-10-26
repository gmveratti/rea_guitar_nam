#!/usr/bin/env python3
"""Fail fast when the Windows installer or its ICO is missing or malformed.

This is a build-time check only. It does not claim that WebView2, playback,
NAM or the graphical interface was tested on a real Windows machine.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "src-tauri"
WINDOWS_CONFIG = TAURI_DIR / "tauri.windows.conf.json"
ICON = TAURI_DIR / "icons" / "icon.ico"
NSIS_DIR = TAURI_DIR / "target" / "release" / "bundle" / "nsis"
EXE = TAURI_DIR / "target" / "release" / "vttrig.exe"


def icon_resolutions(data: bytes) -> set[int]:
    """Read the ICO directory and verify all image payload boundaries."""
    if len(data) < 22:
        raise ValueError("Windows icon is too short")
    reserved, image_type, count = struct.unpack_from("<HHH", data)
    if (reserved, image_type) != (0, 1) or not 1 <= count <= 64:
        raise ValueError("Invalid Windows ICO signature or image count")
    directory_size = 6 + count * 16
    if len(data) < directory_size:
        raise ValueError("Truncated Windows ICO directory")
    sizes: set[int] = set()
    for index in range(count):
        entry = 6 + 16 * index
        width = data[entry] or 256
        height = data[entry + 1] or 256
        payload_length, offset = struct.unpack_from("<II", data, entry + 8)
        if width != height or not payload_length or offset < directory_size:
            raise ValueError("Invalid or nonsquare Windows ICO frame")
        if offset + payload_length > len(data):
            raise ValueError("Windows ICO image payload is truncated")
        sizes.add(width)
    return sizes


def check_preflight() -> None:
    config = json.loads(WINDOWS_CONFIG.read_text(encoding="utf-8"))
    bundle = config.get("bundle", {})
    if bundle.get("targets") != ["nsis"]:
        raise ValueError("Windows override must target only NSIS")
    if bundle.get("icon") != ["icons/icon.ico"]:
        raise ValueError("Windows override must use the generated icon.ico")
    if not ICON.is_file():
        raise FileNotFoundError("Run: npx tauri icon src-tauri/icons/icon.png --output src-tauri/icons")
    sizes = icon_resolutions(ICON.read_bytes())
    if not {32, 256}.issubset(sizes):
        raise ValueError(f"ICO is missing 32px or 256px layers (found {sorted(sizes)})")
    print(f"Windows NSIS config and ICO verified: {sorted(sizes)}px")


def check_postbuild() -> None:
    check_preflight()
    installers = list(NSIS_DIR.glob("*-setup.exe"))
    if len(installers) != 1:
        raise ValueError(f"Expected one NSIS setup.exe in {NSIS_DIR}, got {len(installers)}")
    if installers[0].stat().st_size < 1024 * 1024:
        raise ValueError("NSIS installer is suspiciously small")
    if not EXE.is_file() or EXE.stat().st_size < 1024 * 1024:
        raise ValueError(f"VTTRIG Windows executable missing or too small: {EXE}")
    print(f"Windows installer verified: {installers[0].name} ({installers[0].stat().st_size} bytes)")
    print(f"Desktop executable verified: {EXE.name} ({EXE.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--preflight", action="store_true")
    group.add_argument("--postbuild", action="store_true")
    args = parser.parse_args()
    try:
        check_postbuild() if args.postbuild else check_preflight()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(1, f"Windows bundle validation failed: {error}\n")
