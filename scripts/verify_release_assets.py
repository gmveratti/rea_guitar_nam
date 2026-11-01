"""Fail closed before publishing VTTRIG release installers and standalone DSP ZIPs.

Does not build anything; PR tests supply fake-but-signature-valid files.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import BadZipFile, ZipFile


def verify_assets(tag: str, appimage: Path, installer: Path, linux: Path, windows: Path,
                  root: Path) -> None:
    version = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]
    if tag not in (version, "v" + version):
        raise ValueError(f"Tag {tag} does not match application version {version}")
    for path in (appimage, installer, linux, windows):
        if not path.is_file() or path.stat().st_size < 4:
            raise ValueError(f"Missing, empty or truncated release file: {path}")
    # Never load a potentially gigabyte-scale AppImage/installer into RAM.
    with appimage.open("rb") as image_file:
        if image_file.read(4) != b"\x7fELF":
            raise ValueError("AppImage must begin with an ELF header")
    with installer.open("rb") as installer_file:
        if installer_file.read(2) != b"MZ":
            raise ValueError("Windows installer must begin with an executable header")
    for path, expected_executable in ((linux, "vttrig-nam-offline"),
                                      (windows, "vttrig-nam-offline.exe")):
        try:
            with ZipFile(path) as archive:
                names = set(archive.namelist())
                required = {
                    expected_executable,
                    "licenses/THIRD_PARTY_NOTICES.md",
                    "licenses/NeuralAmpModelerCore_LICENSE",
                }
                if names != required or archive.testzip() is not None:
                    raise ValueError(f"Missing license/archive entry: {path}")
                notices = archive.read("licenses/THIRD_PARTY_NOTICES.md").decode("utf-8")
                core_license = archive.read("licenses/NeuralAmpModelerCore_LICENSE").decode("utf-8")
                if any(word not in notices for word in ("TONE3000", "Airwindows", "DaisySP")):
                    raise ValueError(f"Missing native DSP notice: {path}")
                if "MIT License" not in core_license or "Steven Atkinson" not in core_license:
                    raise ValueError(f"Missing pinned NAM Core license: {path}")
        except BadZipFile as error:
            raise ValueError(f"Invalid standalone archive: {path}") from error
    config = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    resources = config["bundle"]["resources"]
    if resources.get("../engine/THIRD_PARTY_NOTICES.md") != "legal/THIRD_PARTY_NOTICES.md":
        raise ValueError("Installed Tauri DSP notices resource is not configured")
    if resources.get("../engine/NAM_CORE_LICENSE.txt") != "legal/NeuralAmpModelerCore_LICENSE":
        raise ValueError("Installed Tauri NAM Core license resource is not configured")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("assets", type=Path, nargs=4, metavar="ASSET")
    args = parser.parse_args()
    verify_assets(args.tag, *args.assets, root=Path(__file__).resolve().parents[1])


if __name__ == "__main__":
    main()
