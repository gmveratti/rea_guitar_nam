"""Exercise native runtime checks against synthetic PE import tables."""
from __future__ import annotations

from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from check_native_runtime import check_native_runtime, imported_dlls


def pe_image(names: tuple[str, ...], *, delayed: bool = False) -> bytes:
    """Minimal PE32+ image with one section and real import descriptors."""
    data = bytearray(4096)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HHIIIHH", data, 0x84, 0x8664, 1, 0, 0, 0, 240, 0)
    optional = 0x98
    struct.pack_into("<H", data, optional, 0x20B)
    struct.pack_into("<Q", data, optional + 24, 0x140000000)
    struct.pack_into("<I", data, optional + 60, 0x200)
    struct.pack_into("<I", data, optional + 108, 16)
    section = optional + 240
    data[section:section + 8] = b".rdata\0\0"
    struct.pack_into("<IIII", data, section + 8, 0xE00, 0x1000, 0xE00, 0x200)
    directory = optional + 112 + 8 * (13 if delayed else 1)
    width = 32 if delayed else 20
    struct.pack_into("<II", data, directory, 0x1000, width * (len(names) + 1))
    for index, name in enumerate(names):
        offset = 0x200 + index * width
        name_rva = 0x1200 + 64 * index
        if delayed:
            struct.pack_into("<II", data, offset, 1, name_rva)
        else:
            struct.pack_into("<I", data, offset + 12, name_rva)
        encoded = name.encode("ascii") + b"\0"
        name_offset = 0x400 + 64 * index
        data[name_offset:name_offset + len(encoded)] = encoded
    return bytes(data)


class NativeRuntimeChecks(unittest.TestCase):
    def test_reads_real_pe_import_descriptors(self):
        names = ("KERNEL32.dll", "MSVCP140.dll", "VCRUNTIME140_1.dll")
        self.assertEqual(imported_dlls(pe_image(names)), set(names))

    def test_accepts_windows_system_dependencies(self):
        check_native_runtime(pe_image(("KERNEL32.dll", "USER32.dll")))

    def test_rejects_each_msvc_runtime_family_case_insensitively(self):
        for name in ("MSVCP140.dll", "vcruntime140_1.DLL", "CONCRT140.dll", "MSVCR120.dll"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "MSVC runtime"):
                check_native_runtime(pe_image(("KERNEL32.dll", name)))

    def test_rejects_delay_loaded_msvc_runtime(self):
        with self.assertRaisesRegex(ValueError, "MSVC runtime"):
            check_native_runtime(pe_image(("VCRUNTIME140.dll",), delayed=True))

    def test_does_not_reject_unrelated_dll_names(self):
        check_native_runtime(pe_image(("my_vcruntime_helper.dll",)))

    def test_rejects_non_pe_and_truncated_headers(self):
        for data in (b"not a PE", pe_image(())[:120]):
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                imported_dlls(data)

    def test_rejects_unmapped_dll_name_rva(self):
        data = bytearray(pe_image(("KERNEL32.dll",)))
        struct.pack_into("<I", data, 0x200 + 12, 0x9000)
        with self.assertRaisesRegex(ValueError, "RVA"):
            imported_dlls(bytes(data))

    def test_rejects_unterminated_import_directory(self):
        data = bytearray(pe_image(("KERNEL32.dll",)))
        struct.pack_into("<I", data, 0x98 + 112 + 8 + 4, 20)
        with self.assertRaisesRegex(ValueError, "terminated"):
            imported_dlls(bytes(data))

    def test_cli_checks_every_binary_and_fails_for_missing_file(self):
        script = Path(__file__).with_name("check_native_runtime.py")
        with TemporaryDirectory() as folder:
            good = Path(folder) / "live.exe"
            bad = Path(folder) / "offline.exe"
            good.write_bytes(pe_image(("KERNEL32.dll",)))
            bad.write_bytes(pe_image(("MSVCP140.dll",)))
            result = subprocess.run([sys.executable, str(script), str(good), str(bad)],
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("MSVCP140.dll", result.stderr)
            missing = subprocess.run([sys.executable, str(script), str(good.with_name("missing.exe"))],
                                     capture_output=True, text=True, check=False)
            self.assertNotEqual(missing.returncode, 0)


if __name__ == "__main__":
    unittest.main()
