"""Offline release preflight tests; no built or distributed binaries in PRs."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from verify_release_assets import verify_assets
from package_standalone import THIRD_PARTY_LICENSE_NAMES


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
                **{
                    f"../engine/third_party_licenses/{name}": f"legal/{name}"
                    for name in THIRD_PARTY_LICENSE_NAMES
                },
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
                                 "TONE3000 Airwindows DaisySP Eigen nlohmann/json AudioDSPTools")
                archive.writestr("licenses/NeuralAmpModelerCore_LICENSE",
                                 "MIT License Steven Atkinson")
                for name in THIRD_PARTY_LICENSE_NAMES:
                    text = ("Mozilla Public License Version 2.0" if name == "Eigen_COPYING.MPL2.txt"
                            else "MIT License" if name.endswith("_LICENSE.txt")
                            else "Upstream license text")
                    archive.writestr(f"licenses/{name}", text)

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

    def test_missing_transitive_license_in_archive_is_rejected(self):
        with ZipFile(self.windows) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries.pop("licenses/AudioDSPTools_LICENSE.txt")
        with ZipFile(self.windows, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "Missing license"):
            self.verify()

    def test_tauri_resource_mapping_cannot_omit_dependency(self):
        config_path = self.root / "src-tauri/tauri.conf.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["bundle"]["resources"].pop("../engine/third_party_licenses/Eigen_COPYING.MPL2.txt")
        config_path.write_text(json.dumps(config), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Tauri dependency license missing"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
