"""Stage a native release archive with required third-party notices.

Called only by release.published jobs. PR tests use fake binaries in tempfile;
they never publish a compiled executable.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package_standalone(
    binary: Path, notices: Path, nam_core_license: Path, destination: Path
) -> None:
    for path in (binary, notices, nam_core_license):
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing or empty release asset: {path}")
    contents = notices.read_text(encoding="utf-8")
    required = ("TONE3000", "Airwindows", "DaisySP")
    if any(name not in contents for name in required):
        raise ValueError("DSP attribution is incomplete")
    license_text = nam_core_license.read_text(encoding="utf-8")
    if "MIT License" not in license_text or "Steven Atkinson" not in license_text:
        raise ValueError("NAM Core license not recognized")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        archive.write(binary, arcname=binary.name)
        archive.write(notices, arcname="licenses/THIRD_PARTY_NOTICES.md")
        archive.write(nam_core_license, arcname="licenses/NeuralAmpModelerCore_LICENSE")
    with ZipFile(destination) as archive:
        names = set(archive.namelist())
        expected = {
            binary.name, "licenses/THIRD_PARTY_NOTICES.md",
            "licenses/NeuralAmpModelerCore_LICENSE",
        }
        if names != expected or archive.testzip() is not None:
            raise ValueError("Release archive missing content or corrupted")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--notices", type=Path, required=True)
    parser.add_argument("--nam-core-license", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package_standalone(
        args.binary, args.notices, args.nam_core_license, args.output
    )


if __name__ == "__main__":
    main()
