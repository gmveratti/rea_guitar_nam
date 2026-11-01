"""Guard the central PR quality gate and release-only distribution.

No installers or standalone downloads may be produced/published on PR/main.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = {
    "windows": ROOT / ".github/workflows/tauri-windows.yml",
    "linux": ROOT / ".github/workflows/tauri-linux.yml",
    "nam": ROOT / ".github/workflows/nam-engine.yml",
}
BINARY_STEPS = {
    "windows": ("Build VTTRIG installer for Windows x64",
                "Validate NSIS installer and desktop executable",
                "Publish Windows installer download"),
    "linux": ("Build VTTRIG AppImage (x86_64)",
              "Validate Linux executables",
              "Publish downloadable Fedora/Linux test build"),
    "nam": ("Package Windows NAM processor with licenses",
            "Publish standalone Windows NAM processor",
            "Package Linux NAM processor with licenses",
            "Publish standalone Linux NAM processor"),
}


class ReleaseDistributionPolicy(unittest.TestCase):
    def test_reusable_validators_cannot_publish_directly(self):
        for name, path in WORKFLOWS.items():
            with self.subTest(workflow=name):
                content = path.read_text(encoding="utf-8")
                self.assertIn("\non:\n  workflow_call:\n", content)
                self.assertNotIn("\n  release:\n", content)
                self.assertNotIn("\n  publish-release:\n", content)
                self.assertNotIn("gh release upload", content)
                self.assertRegex(content, r"(?m)^permissions:\n  contents: read$")

    def test_always_created_gate_has_all_consumer_dependencies(self):
        gate = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertRegex(gate, r"(?m)^  pull_request:")
        self.assertRegex(gate, r"(?m)^  push:\n    branches: \[main\]")
        self.assertIn("name: VTTRIG / quality-gate", gate)
        self.assertIn("if: always()", gate)
        self.assertIn("needs: [changes, ui, tauri-linux, tauri-windows, nam]", gate)
        for reusable in ("ui-checks.yml", "tauri-linux.yml",
                         "tauri-windows.yml", "nam-engine.yml"):
            self.assertIn("uses: ./.github/workflows/" + reusable, gate)

    def test_binary_steps_are_only_for_published_release(self):
        for workflow, path in WORKFLOWS.items():
            content = path.read_text(encoding="utf-8")
            for step in BINARY_STEPS[workflow]:
                with self.subTest(workflow=workflow, step=step):
                    self.assertRegex(
                        content,
                        rf"(?m)^      - name: {re.escape(step)}\n"
                        rf"        if: github\.event_name == 'release'"
                        rf"(?: && runner\.os == '(?:Linux|Windows)')?\n",
                    )

    def test_single_coordinated_release_waits_for_all_successful_jobs(self):
        release = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn("\non:\n  release:\n    types: [published]", release)
        self.assertIn("cancel-in-progress: false", release)
        self.assertIn("needs: [ui, tauri-linux, tauri-windows, nam]", release)
        self.assertIn("scripts/verify_release_assets.py", release)
        self.assertIn("SHA256SUMS.txt", release)
        self.assertIn("gh release upload", release)
        self.assertIn("permissions:\n      contents: write", release)
        self.assertIn('gh release upload "$RELEASE_TAG"', release)
        self.assertIn("images=(release-assets/linux/bundle/appimage/*.AppImage)", release)
        self.assertNotIn("images=(release-assets/*.AppImage)", release)

    def test_no_release_privileges_in_pr_gate(self):
        gate = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read", gate)
        self.assertNotIn("contents: write", gate)


if __name__ == "__main__":
    unittest.main()
