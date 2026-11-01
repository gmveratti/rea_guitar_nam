"""Classify the changed paths for VTTRIG's always-created PR quality gate.

Conservative by design: unknown source/config files run every job.
Documentation-only changes skip compilation but never skip the final gate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import PurePosixPath


def classify(paths: list[str]) -> dict[str, bool]:
    result = {"ui": False, "tauri": False, "nam": False}
    if not paths:
        # Unknown diff (e.g. first push): do not allow skipping validation.
        return dict.fromkeys(result, True)
    for raw in paths:
        path = raw.strip().replace("\\", "/")
        if not path:
            continue
        if path.startswith(("docs/",)) or path in {"README.md", "AGENTS.md"}:
            continue
        if path == "engine/CMakeLists.txt":
            return dict.fromkeys(result, True)
        if path.startswith(("src-tauri/src/", "src-tauri/capabilities/")):
            result["tauri"] = True
        elif path.startswith("engine/"):
            result["tauri"] = True
            result["nam"] = True
        elif path.startswith(("src/", "e2e/")) or path in {"index.html", "vite.config.ts", "vitest.config.ts", "playwright.config.ts", "tsconfig.json"}:
            result["ui"] = True
            if path in {"src/lib/liveRig.ts", "src/lib/signalChain.ts"}:
                result["tauri"] = True
                result["nam"] = True
        else:
            # Workflow, package manifests, lockfiles, scripts and unknown
            # paths may affect several runners or the build contracts.
            return dict.fromkeys(result, True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths_file", type=PurePosixPath)
    args = parser.parse_args()
    from pathlib import Path

    paths = Path(args.paths_file).read_text(encoding="utf-8").splitlines()
    print(json.dumps(classify(paths), sort_keys=True))


if __name__ == "__main__":
    main()
