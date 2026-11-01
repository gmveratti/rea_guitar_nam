"""Regression guard for reproducible, lockfile-enforced VTTRIG builds."""
from pathlib import Path
import json
import re
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = [
    ROOT / ".github/workflows/ui-checks.yml",
    ROOT / ".github/workflows/tauri-linux.yml",
    ROOT / ".github/workflows/tauri-windows.yml",
    ROOT / ".github/workflows/nam-engine.yml",
]


class ReproducibleBuildPolicy(unittest.TestCase):
    def test_node_and_rust_versions_are_explicit(self):
        self.assertEqual((ROOT / ".node-version").read_text().strip(), "22.16.0")
        toolchain = tomllib.loads((ROOT / "rust-toolchain.toml").read_text())
        self.assertEqual(toolchain["toolchain"]["channel"], "1.99.0")
        self.assertIn("rustfmt", toolchain["toolchain"]["components"])
        self.assertIn("clippy", toolchain["toolchain"]["components"])

    def test_committed_lockfiles_match_manifests(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lock["lockfileVersion"], 3)
        self.assertEqual(lock["name"], package["name"])
        self.assertEqual(lock["version"], package["version"])
        self.assertEqual(lock["packages"][""]["dependencies"], package["dependencies"])
        self.assertEqual(lock["packages"][""]["devDependencies"], package["devDependencies"])
        cargo = (ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8")
        self.assertRegex(cargo, r'(?m)^version = 4$')
        self.assertIn('name = "vttrig"', cargo)

    def test_every_ci_uses_sha_pinned_actions(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                contents = workflow.read_text(encoding="utf-8")
                for line in contents.splitlines():
                    match = re.search(r"\buses:\s+([^\s#]+)", line)
                    if match:
                        action = match.group(1)
                        self.assertRegex(action, r"^[-\w]+/[-\w]+@[0-9a-f]{40}$")
                self.assertNotIn("npm install --no-audit", contents)

    def test_native_runners_are_locked(self):
        for name in ("tauri-linux.yml", "tauri-windows.yml"):
            contents = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
            self.assertIn("npm ci --no-audit --no-fund", contents)
            self.assertIn("cargo check --locked", contents)
            self.assertIn("cargo clippy --locked", contents)
            self.assertIn("cargo test --locked", contents)
        ui = (ROOT / ".github/workflows/ui-checks.yml").read_text(encoding="utf-8")
        self.assertIn("npm ci --no-audit --no-fund", ui)


if __name__ == "__main__":
    unittest.main()
