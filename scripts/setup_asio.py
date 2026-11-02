#!/usr/bin/env python3
"""Prepare the pinned official Steinberg SDK for CPAL's Windows ASIO backend."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK_URL = "https://www.steinberg.net/asiosdk"
SDK_SHA256 = "d5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca"
SDK_VERSION = "2.3.4"
REQUIRED_FILES = (
    "common/asio.h", "common/asiosys.h", "common/iasiodrv.h",
    "common/asio.cpp", "host/asiodrivers.h", "host/asiodrivers.cpp",
    "host/pc/asiolist.cpp", "LICENSE.txt",
)


def prepare_sdk(archive: Path, output: Path, legal_dir: Path) -> Path:
    """Verify before extraction; return the SDK root expected by CPAL_ASIO_DIR."""
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != SDK_SHA256:
        raise ValueError(f"ASIO SDK SHA256 mismatch: expected {SDK_SHA256}, got {actual}")
    destination = output.resolve()
    with zipfile.ZipFile(archive) as sdk_zip:
        # Fail before writing anything if the upstream archive contains a path
        # outside the selected SDK directory.
        for entry in sdk_zip.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination):
                raise ValueError(f"ASIO archive member is outside output directory: {entry.filename}")
        for filename in REQUIRED_FILES:
            if "ASIOSDK/" + filename not in sdk_zip.namelist():
                raise ValueError(f"ASIO SDK layout is missing {filename}")
        sdk_zip.extractall(destination)
    sdk = destination / "ASIOSDK"
    legal_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(sdk / "LICENSE.txt", legal_dir / "ASIO_SDK_LICENSE.txt")
    shutil.copyfile(ROOT / "engine/third_party_licenses/GPL-3.0.txt", legal_dir / "GPL-3.0.txt")
    return sdk


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="Use an already downloaded, checksum-verified archive")
    parser.add_argument("--github-env", type=Path, help="Export CPAL_ASIO_DIR to this GitHub Actions environment file")
    args = parser.parse_args()
    archive = args.archive
    if archive is None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        archive = args.output.parent / "vttrig-asiosdk-2.3.4.zip"
        with urllib.request.urlopen(SDK_URL, timeout=60) as response, archive.open("wb") as file:
            shutil.copyfileobj(response, file)
    sdk = prepare_sdk(archive, args.output, args.output / "legal")
    if args.github_env:
        with args.github_env.open("a", encoding="utf-8") as environment:
            environment.write(f"CPAL_ASIO_DIR={sdk}\n")
    print(f"ASIO SDK {SDK_VERSION} verified: {sdk}")


if __name__ == "__main__":
    main()
