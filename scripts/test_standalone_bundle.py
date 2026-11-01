import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from package_standalone import package_standalone

ROOT = Path(__file__).resolve().parents[1]


class LicenseStagingTests(unittest.TestCase):
    def test_tauri_bundle_contains_notices_for_installed_app(self):
        config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        resources = config["bundle"]["resources"]
        self.assertEqual(
            resources["../engine/THIRD_PARTY_NOTICES.md"],
            "legal/THIRD_PARTY_NOTICES.md",
        )
        self.assertTrue((ROOT / "engine/THIRD_PARTY_NOTICES.md").is_file())
        self.assertEqual(
            resources["../engine/NAM_CORE_LICENSE.txt"],
            "legal/NeuralAmpModelerCore_LICENSE",
        )
        self.assertIn("MIT License", (ROOT / "engine/NAM_CORE_LICENSE.txt").read_text(encoding="utf-8"))

    def test_fake_standalone_contains_binary_and_license_files(self):
        with TemporaryDirectory() as temp:
            base = Path(temp)
            binary = base / "vttrig-nam-offline.exe"
            notices = base / "THIRD_PARTY_NOTICES.md"
            core = base / "LICENSE"
            archive = base / "vttrig-test.zip"
            binary.write_bytes(b"fake test executable")
            notices.write_text("TONE3000 Airwindows DaisySP", encoding="utf-8")
            core.write_text("MIT License\nSteven Atkinson", encoding="utf-8")
            package_standalone(binary, notices, core, archive)
            with ZipFile(archive) as result:
                self.assertEqual(set(result.namelist()), {
                    "vttrig-nam-offline.exe",
                    "licenses/THIRD_PARTY_NOTICES.md",
                    "licenses/NeuralAmpModelerCore_LICENSE",
                })
                self.assertEqual(result.read(binary.name), b"fake test executable")

    def test_missing_notice_or_core_license_fails_closed(self):
        with TemporaryDirectory() as temp:
            base = Path(temp)
            binary = base / "vttrig-nam-offline"
            notices = base / "THIRD_PARTY_NOTICES.md"
            core = base / "LICENSE"
            destination = base / "bundle.zip"
            binary.write_bytes(b"fake test executable")
            notices.write_text("TONE3000 Airwindows DaisySP", encoding="utf-8")
            with self.assertRaises(ValueError):
                package_standalone(binary, notices, core, destination)
            self.assertFalse(destination.exists())
            core.write_text("MIT License\nSteven Atkinson", encoding="utf-8")
            notices.write_text("missing acknowledgements", encoding="utf-8")
            with self.assertRaises(ValueError):
                package_standalone(binary, notices, core, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
