"""Regression checks for the Windows installer verification routine."""
from __future__ import annotations

import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import check_windows_bundle as bundle


def fake_ico(sizes: tuple[int, ...] = (32, 256)) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(sizes))
    payload = b"PNG!" * 5
    start = 6 + 16 * len(sizes)
    entries = []
    for index, size in enumerate(sizes):
        entries.append(
            struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                        1, 32, len(payload), start + index * len(payload))
        )
    return header + b"".join(entries) + payload * len(sizes)


class WindowsBundleChecks(unittest.TestCase):
    def test_ico_resolutions_detects_32_and_256(self):
        self.assertEqual(bundle.icon_resolutions(fake_ico()), {32, 256})

    def test_truncated_ico_fails(self):
        with self.assertRaisesRegex(ValueError, "too short"):
            bundle.icon_resolutions(b"\x00\x00\x01")

    def test_invalid_icon_header_fails(self):
        invalid = bytearray(fake_ico())
        invalid[2] = 2
        with self.assertRaisesRegex(ValueError, "signature"):
            bundle.icon_resolutions(bytes(invalid))

    def test_truncated_frame_payload_fails(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            bundle.icon_resolutions(fake_ico()[:-2])

    def test_nonsquare_frame_fails(self):
        invalid = bytearray(fake_ico())
        invalid[7] = 16
        with self.assertRaisesRegex(ValueError, "nonsquare"):
            bundle.icon_resolutions(bytes(invalid))

    def test_missing_256_icon_is_rejected_by_preflight(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "tauri.windows.conf.json"
            icon = root / "icon.ico"
            config.write_text(json.dumps({"bundle": {"targets": ["nsis"], "icon": ["icons/icon.ico"]}}))
            icon.write_bytes(fake_ico((32,)))
            with patch.object(bundle, "WINDOWS_CONFIG", config), patch.object(bundle, "ICON", icon):
                with self.assertRaisesRegex(ValueError, "missing 32px or 256px"):
                    bundle.check_preflight()

    def test_windows_config_does_not_accept_linux_appimage_target(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "tauri.windows.conf.json"
            icon = root / "icon.ico"
            config.write_text(json.dumps({"bundle": {"targets": ["appimage"], "icon": ["icons/icon.ico"]}}))
            icon.write_bytes(fake_ico())
            with patch.object(bundle, "WINDOWS_CONFIG", config), patch.object(bundle, "ICON", icon):
                with self.assertRaisesRegex(ValueError, "NSIS"):
                    bundle.check_preflight()

    def test_valid_preflight_does_not_need_compiled_exe(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "tauri.windows.conf.json"
            icon = root / "icon.ico"
            config.write_text(json.dumps({"bundle": {"targets": ["nsis"], "icon": ["icons/icon.ico"]}}))
            icon.write_bytes(fake_ico())
            with patch.object(bundle, "WINDOWS_CONFIG", config), patch.object(bundle, "ICON", icon):
                bundle.check_preflight()


if __name__ == "__main__":
    unittest.main()
