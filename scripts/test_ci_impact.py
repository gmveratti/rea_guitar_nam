"""Regression tests: never silently skip a consumer of a shared contract."""
import unittest

from ci_impact import classify


class ImpactTests(unittest.TestCase):
    def test_docs_only_uses_no_build_runner(self):
        self.assertEqual(classify(["README.md", "docs/TESTING.md"]),
                         {"ui": False, "tauri": False, "nam": False})

    def test_frontend_only(self):
        self.assertEqual(classify(["src/app.css", "e2e/pedalboard.spec.ts"]),
                         {"ui": True, "tauri": False, "nam": False})

    def test_rust_only(self):
        self.assertEqual(classify(["src-tauri/src/audio.rs"]),
                         {"ui": False, "tauri": True, "nam": False})

    def test_dsp_always_runs_native_consumers(self):
        self.assertEqual(classify(["engine/src/classic_delay.hpp"]),
                         {"ui": False, "tauri": True, "nam": True})

    def test_shared_manifest_runs_everything(self):
        self.assertEqual(classify(["src/lib/liveRig.ts"]),
                         {"ui": True, "tauri": True, "nam": True})

    def test_lockfile_or_workflow_changes_run_everything(self):
        for file in ("package-lock.json", "src-tauri/Cargo.lock",
                     ".github/workflows/ci.yml", "engine/CMakeLists.txt"):
            with self.subTest(path=file):
                self.assertEqual(classify([file]),
                                 {"ui": True, "tauri": True, "nam": True})

    def test_unknown_or_empty_diff_runs_everything(self):
        self.assertEqual(classify([]), {"ui": True, "tauri": True, "nam": True})
        self.assertEqual(classify(["new-unknown-file"]), {"ui": True, "tauri": True, "nam": True})


if __name__ == "__main__":
    unittest.main()
