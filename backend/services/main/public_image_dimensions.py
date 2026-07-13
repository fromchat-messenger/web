"""Header-only image dimension reads for very large public-chat attachments."""

from __future__ import annotations

import logging
import struct
from pathlib import Path

logger = logging.getLogger("uvicorn.error")

_HEADER_READ_BYTES = 4 * 1024 * 1024
_HEADER_READ_MAX_BYTES = 16 * 1024 * 1024
_JPEG_SOF_MARKERS = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)


def is_placeholder_dimensions(width: int, height: int) -> bool:
    return width <= 1 and height <= 1


def read_image_dimensions_from_path(path: Path) -> list[int] | None:
    """Read pixel width/height without decoding multi-hundred-MP images."""
    try:
        with path.open("rb") as handle:
            header = handle.read(_HEADER_READ_BYTES)
            result = read_image_dimensions_from_bytes(header, path.suffix)
            if result is not None:
                return result
            while len(header) < _HEADER_READ_MAX_BYTES:
                extra = handle.read(_HEADER_READ_BYTES)
                if not extra:
                    break
                header += extra
                result = read_image_dimensions_from_bytes(header, path.suffix)
                if result is not None:
                    return result
        return None
    except Exception as error:
        logger.warning("PUBLIC THUMB: header read failed for %s: %s", path, error)
        return None


def read_image_dimensions_from_bytes(data: bytes, suffix: str = "") -> list[int] | None:
    if not data:
        return None
    ext = suffix.lower()
    wh: tuple[int, int] | None = None
    if data.startswith(b"\xff\xd8"):
        wh = _jpeg_dimensions(data)
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        wh = _png_dimensions(data)
    elif data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        wh = _gif_dimensions(data)
    elif data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        wh = _webp_dimensions(data)
    elif ext in {".jpg", ".jpeg"}:
        wh = _jpeg_dimensions(data)
    elif ext == ".png":
        wh = _png_dimensions(data)
    elif ext == ".gif":
        wh = _gif_dimensions(data)
    elif ext == ".webp":
        wh = _webp_dimensions(data)
    if wh is None:
        wh = _pil_dimensions_fallback(data)
    if wh is None:
        return None
    width, height = wh
    if is_placeholder_dimensions(width, height):
        return None
    return [width, height]


def _apply_exif_orientation(width: int, height: int, orientation: int) -> tuple[int, int]:
    if orientation in {5, 6, 7, 8}:
        return height, width
    return width, height


def _parse_exif_orientation(exif_bytes: bytes) -> int | None:
    try:
        if len(exif_bytes) < 8:
            return None
        endian = exif_bytes[0:2]
        if endian == b"II":
            endianness = "<"
        elif endian == b"MM":
            endianness = ">"
        else:
            return None
        ifd_offset = struct.unpack(endianness + "I", exif_bytes[4:8])[0]
        if ifd_offset + 2 > len(exif_bytes):
            return None
        count = struct.unpack(endianness + "H", exif_bytes[ifd_offset : ifd_offset + 2])[0]
        cursor = ifd_offset + 2
        for _ in range(count):
            if cursor + 12 > len(exif_bytes):
                break
            tag, field_type, value_count = struct.unpack(endianness + "HHI", exif_bytes[cursor : cursor + 8])
            value_offset = struct.unpack(endianness + "I", exif_bytes[cursor + 8 : cursor + 12])[0]
            if tag == 0x0112:
                if field_type == 3 and value_count == 1:
                    if value_offset <= 0xFFFF:
                        return value_offset & 0xFFFF
                    if value_offset + 2 <= len(exif_bytes):
                        return struct.unpack(endianness + "H", exif_bytes[value_offset : value_offset + 2])[0]
            cursor += 12
    except Exception:
        return None
    return None


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read JPEG SOF dimensions and apply EXIF orientation when present.

    EXIF APP1 may appear after the SOF segment; scan the full header before returning.
    """
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return None
    orientation = 1
    sof_width: int | None = None
    sof_height: int | None = None
    index = 2
    while index + 4 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break
        marker = data[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(data):
            break
        segment_length = struct.unpack(">H", data[index : index + 2])[0]
        if segment_length < 2:
            break
        segment_start = index + 2
        segment_end = index + segment_length
        if segment_end > len(data):
            break
        if marker == 0xE1 and segment_end - segment_start > 8:
            exif = data[segment_start:segment_end]
            if exif[:6] == b"Exif\x00\x00":
                parsed = _parse_exif_orientation(exif[6:])
                if parsed is not None:
                    orientation = parsed
        if (
            sof_width is None
            and marker in _JPEG_SOF_MARKERS
            and segment_end - segment_start >= 7
        ):
            sof_height = struct.unpack(">H", data[segment_start + 3 : segment_start + 5])[0]
            sof_width = struct.unpack(">H", data[segment_start + 5 : segment_start + 7])[0]
        index = segment_end
    if sof_width is None or sof_height is None:
        return None
    return _apply_exif_orientation(sof_width, sof_height, orientation)


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width = struct.unpack(">I", data[16:20])[0]
    height = struct.unpack(">I", data[20:24])[0]
    if width <= 0 or height <= 0:
        return None
    return width, height


def _gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10:
        return None
    width = struct.unpack("<H", data[6:8])[0]
    height = struct.unpack("<H", data[8:10])[0]
    if width <= 0 or height <= 0:
        return None
    return width, height


def _webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8 " and len(data) >= 30:
        width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        if width > 0 and height > 0:
            return width, height
    if chunk == b"VP8L" and len(data) >= 25:
        bits = struct.unpack("<I", data[21:25])[0]
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        if width > 0 and height > 0:
            return width, height
    if chunk == b"VP8X" and len(data) >= 30:
        width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16))
        height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16))
        if width > 1 and height > 1:
            return width, height
    return None


def _pil_dimensions_fallback(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image, ImageOps

        with Image.open(__import__("io").BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
        if width <= 0 or height <= 0:
            return None
        return width, height
    except Exception as error:
        logger.warning("PUBLIC THUMB: PIL fallback failed: %s", error)
        return None
