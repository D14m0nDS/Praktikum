"""Normalize RFID UIDs (hex strings) from Arduino / readers."""

from __future__ import annotations

import re

_HEX = re.compile(r"^[0-9A-F]+$")


def normalize_uid(uid: str) -> str:
    """
    Strip, uppercase, remove colons/spaces. Must be non-empty hex.
    Raises ValueError if invalid.
    """
    if not isinstance(uid, str):
        raise ValueError("uid must be a string")
    u = uid.strip().upper().replace(":", "").replace(" ", "")
    if not u or not _HEX.match(u):
        raise ValueError("uid must be a non-empty hexadecimal string")
    return u
