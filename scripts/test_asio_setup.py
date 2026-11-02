from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import setup_asio


class AsioSetupTests(unittest.TestCase):
    def archive(self, root: Path, *, omit: str = "") -> Path:
        archive = root / "asio.zip"
        with zipfile.ZipFile(archive, "w") as sdk:
            for member in setup_asio.REQUIRED_FILES:
                if member != omit:
                    sdk.writestr("ASIOSDK/" + member, "SDK fixture")
        return archive

    def test_verified_sdk_exports_exact_cpal_layout_and_licenses(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = self.archive(root)
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(setup_asio, "SDK_SHA256", checksum):
                sdk = setup_asio.prepare_sdk(archive, root / "unpacked", root / "legal")
            self.assertTrue((sdk / "common/asio.h").is_file())
            self.assertTrue((root / "legal/ASIO_SDK_LICENSE.txt").is_file())
            self.assertTrue((root / "legal/GPL-3.0.txt").is_file())

    def test_windows_installer_includes_sdk_license_and_gpl_text(self):
        resources = json.loads((setup_asio.ROOT / "src-tauri/tauri.windows.conf.json").read_text())["bundle"]["resources"]
        for name in ("ASIO_SDK_LICENSE.txt", "GPL-3.0.txt", "ASIO_NOTICE.txt"):
            source = "../engine/third_party_licenses/" + name
            self.assertEqual(resources[source], "legal/" + name)
            self.assertTrue((setup_asio.ROOT / "src-tauri" / source).is_file())

    def test_changed_download_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = self.archive(root)
            with self.assertRaisesRegex(ValueError, "SHA256"):
                setup_asio.prepare_sdk(archive, root / "unpacked", root / "legal")
            self.assertFalse((root / "unpacked").exists())

    def test_missing_binding_header_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = self.archive(root, omit="host/asiodrivers.h")
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(setup_asio, "SDK_SHA256", checksum):
                with self.assertRaisesRegex(ValueError, "host/asiodrivers.h"):
                    setup_asio.prepare_sdk(archive, root / "unpacked", root / "legal")

    def test_zip_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = self.archive(root)
            with zipfile.ZipFile(archive, "a") as sdk:
                sdk.writestr("../outside", "no")
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(setup_asio, "SDK_SHA256", checksum):
                with self.assertRaisesRegex(ValueError, "outside"):
                    setup_asio.prepare_sdk(archive, root / "unpacked", root / "legal")
            self.assertFalse((root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
