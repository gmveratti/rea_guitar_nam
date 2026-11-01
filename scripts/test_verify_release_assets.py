"""Offline release preflight tests; no built or distributed binaries in PRs."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from verify_release_assets import verify_assets


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "src-tauri").mkdir()
        (self.root / "src-tauri/tauri.conf.json").write_text(json.dumps({
            "version": "0.1.2",
            "bundle": {"resources": {
                "../engine/THIRD_PARTY_NOTICES.md": "legal/THIRD_PARTY_NOTICES.md",
                "../engine/NAM_CORE_LICENSE.txt": "legal/NeuralAmpModelerCore_LICENSE",
            }},
        }), encoding="utf-8")
        self.image = self.root / "test.AppImage"
        self.installer = self.root / "test-setup.exe"
        self.linux = self.root / "linux.zip"
        self.windows = self.root / "windows.zip"
        self.image.write_bytes(b"\x7fELF-fake")
        self.installer.write_bytes(b"MZ-fake")
        for path, exe in ((self.linux, "vttrig-nam-offline"),
                          (self.windows, "vttrig-nam-offline.exe")):
            with ZipFile(path, "w") as archive:
                archive.writestr(exe, b"fake binary")
                archive.writestr("licenses/THIRD_PARTY_NOTICES.md",
                                 "TONE3000 Airwindows DaisySP")
                archive.writestr("licenses/NeuralAmpModelerCore_LICENSE",
                                 "MIT License Steven Atkinson")

    def verify(self, tag="v0.1.2"):
        verify_assets(tag, self.image, self.installer, self.linux,
                      self.windows, root=self.root)

    def test_valid_complete_set(self):
        self.verify()

    def test_wrong_version_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.verify("v9.9.9")

    def test_missing_installer_is_rejected(self):
        self.installer.unlink()
        with self.assertRaisesRegex(ValueError, "Missing"):
            self.verify()

    def test_missing_native_notice_is_rejected(self):
        with ZipFile(self.windows, "w") as archive:
            archive.writestr("vttrig-nam-offline.exe", b"fake")
            archive.writestr("licenses/NeuralAmpModelerCore_LICENSE",
                             "MIT License Steven Atkinson")
        with self.assertRaisesRegex(ValueError, "Missing license"):
            self.verify()

    def test_wrong_native_signature_is_rejected(self):
        self.image.write_bytes(b"wrong")
        with self.assertRaisesRegex(ValueError, "ELF"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
