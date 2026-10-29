"""Regression guard: PR/main CI validates sources; only published releases ship binaries.

This is deliberately a dependency-free structural check of our workflows,
not a general YAML parser. GitHub Actions validates the YAML itself.
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
    "windows": (
        "Build VTTRIG installer for Windows x64",
        "Validate NSIS installer and desktop executable",
        "Publish Windows installer download",
    ),
    "linux": (
        "Build VTTRIG AppImage (x86_64)",
        "Validate Linux executables",
        "Publish downloadable Fedora/Linux test build",
    ),
    "nam": (
        "Publish standalone Windows NAM processor",
        "Publish standalone Linux NAM processor",
    ),
}


class ReleaseDistributionPolicy(unittest.TestCase):
    def test_published_release_is_explicit_trigger_and_regular_ci_is_preserved(self):
        for name, path in WORKFLOWS.items():
            with self.subTest(workflow=name):
                content = path.read_text(encoding="utf-8")
                self.assertIn("\non:\n", content)
                self.assertRegex(content, r"(?m)^  pull_request:")
                self.assertRegex(content, r"(?m)^  push:\n    branches:")
                self.assertRegex(content, r"(?m)^  release:\n    types: \[published\]")
                self.assertRegex(content, r"(?m)^  publish-release:\n    name: .*\n"
                                          r"    if: github\.event_name == 'release'")
                self.assertIn("needs:", content)
                self.assertIn("gh release upload", content)

    def test_binary_steps_are_skipped_for_pr_main_and_manual_runs(self):
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

    def test_release_asset_upload_uses_separate_write_scoped_job(self):
        for workflow, path in WORKFLOWS.items():
            with self.subTest(workflow=workflow):
                content = path.read_text(encoding="utf-8")
                published = content.split("\n  publish-release:\n", maxsplit=1)
                self.assertEqual(len(published), 2)
                # Build/check jobs retain read-only contents permission.
                self.assertRegex(published[0], r"(?m)^permissions:\n  contents: read$")
                self.assertRegex(published[1], r"(?m)^    permissions:\n      contents: write$")
                self.assertIn("actions/download-artifact@v4", published[1])
                # Publisher jobs do not checkout the repository; gh needs an explicit target.
                self.assertIn('--repo "$GITHUB_REPOSITORY"', published[1])

    def test_linux_release_uses_the_artifact_subdirectory_for_appimage(self):
        content = WORKFLOWS["linux"].read_text(encoding="utf-8")
        self.assertIn(
            "images=(release-assets/bundle/appimage/*.AppImage)", content
        )
        self.assertNotIn("images=(release-assets/*.AppImage)", content)


if __name__ == "__main__":
    unittest.main()
