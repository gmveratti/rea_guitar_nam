#!/usr/bin/env python3
"""Reject native Windows executables requiring an unbundled MSVC runtime.

Inspect PE import tables, including delay imports, rather than relying on the
build machine's installed redistributables. Uses only the Python standard library.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import struct


def imported_dlls(data: bytes) -> set[str]:
    """Read DLL dependencies from a PE32 or PE32+ executable, failing closed."""
    def unpack(format_: str, offset: int) -> tuple[int, ...]:
        size = struct.calcsize(format_)
        if offset < 0 or offset + size > len(data):
            raise ValueError("Truncated PE headers or import table")
        return struct.unpack_from(format_, data, offset)

    if data[:2] != b"MZ":
        raise ValueError("Expected a Windows PE executable")
    pe, = unpack("<I", 0x3C)
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Invalid PE signature")
    _, count, _, _, _, optional_size, _ = unpack("<HHIIIHH", pe + 4)
    optional = pe + 24
    magic, = unpack("<H", optional)
    if magic == 0x20B:
        directory_offset, count_offset, image_base_offset, base_format = 112, 108, 24, "<Q"
    elif magic == 0x10B:
        directory_offset, count_offset, image_base_offset, base_format = 96, 92, 28, "<I"
    else:
        raise ValueError("Unsupported PE optional header")
    if optional_size < directory_offset:
        raise ValueError("Truncated PE optional header")
    image_base, = unpack(base_format, optional + image_base_offset)
    header_size, = unpack("<I", optional + 60)
    directory_count, = unpack("<I", optional + count_offset)
    if directory_offset + 8 * directory_count > optional_size:
        raise ValueError("Truncated PE data directories")
    sections = []
    for index in range(count):
        section = optional + optional_size + 40 * index
        virtual_size, address, raw_size, raw_offset = unpack("<IIII", section + 8)
        sections.append((address, max(virtual_size, raw_size), raw_size, raw_offset))

    def file_offset(rva: int, size: int = 1) -> int:
        if 0 <= rva < header_size and rva + size <= min(header_size, len(data)):
            return rva
        for address, virtual_size, raw_size, raw_offset in sections:
            if address <= rva < address + virtual_size:
                relative = rva - address
                offset = raw_offset + relative
                if relative + size <= raw_size and offset + size <= len(data):
                    return offset
                break
        raise ValueError(f"Invalid or truncated PE RVA: 0x{rva:X}")

    names: set[str] = set()
    # IMAGE_IMPORT_DESCRIPTOR and IMAGE_DELAYLOAD_DESCRIPTOR respectively.
    for directory_index, width, name_field in ((1, 20, 12), (13, 32, 4)):
        if directory_index >= directory_count:
            continue
        table_rva, table_size = unpack("<II", optional + directory_offset + 8 * directory_index)
        if table_rva == 0 and table_size == 0:
            continue
        terminated = False
        for relative in range(0, table_size - width + 1, width):
            descriptor = file_offset(table_rva + relative, width)
            if not any(data[descriptor:descriptor + width]):
                terminated = True
                break
            name_rva, = unpack("<I", descriptor + name_field)
            if directory_index == 13:
                attributes, = unpack("<I", descriptor)
                if not attributes & 1:
                    name_rva -= image_base
            name_offset = file_offset(name_rva)
            end = data.find(b"\0", name_offset, name_offset + 260)
            if end < 0:
                raise ValueError("Unterminated PE imported DLL name")
            # Verify that the entire name stays inside its section's raw bytes.
            file_offset(name_rva, end - name_offset + 1)
            try:
                name = data[name_offset:end].decode("ascii")
            except UnicodeDecodeError as error:
                raise ValueError("Invalid PE imported DLL name") from error
            if not name:
                raise ValueError("Empty PE imported DLL name")
            names.add(name)
        if not terminated:
            raise ValueError("PE import directory is not null-terminated")
    return names


def check_native_runtime(data: bytes) -> set[str]:
    """Return imports or reject dependencies on redistributable MSVC DLLs."""
    imports = imported_dlls(data)
    dynamic_runtime = sorted(name for name in imports if re.fullmatch(
        r"(?:msvcp|msvcr|vcruntime|concrt)\d[^/\\]*\.dll", name, re.IGNORECASE))
    if dynamic_runtime:
        raise ValueError("Unbundled MSVC runtime dependency: " + ", ".join(dynamic_runtime))
    return imports


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binaries", type=Path, nargs="+")
    args = parser.parse_args()
    for binary in args.binaries:
        try:
            dependencies = check_native_runtime(binary.read_bytes())
        except (OSError, ValueError) as error:
            parser.exit(1, f"Native runtime validation failed for {binary}: {error}\n")
        print(f"Native runtime verified: {binary} ({', '.join(sorted(dependencies))})")
