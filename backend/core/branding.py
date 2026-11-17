"""Validation and safe loading for agency white-label branding.

Branding values end up in CSS (colours), <img> tags and the server-side PDF
renderer (logos), so they are validated strictly rather than trusted.
"""

from __future__ import annotations

import base64
import binascii
import ipaddress
import re
import socket
from urllib.parse import urlparse

import requests
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from rest_framework import serializers

MAX_LOGO_BYTES = 600 * 1024
_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$")
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_COLOR_KEYS = ("primary_color", "accent_color")
_TEXT_LIMITS = {"company_name": 120, "footer_text": 300}


def decode_data_url(value: str) -> bytes | None:
    """Raw bytes of a data:image/(png|jpeg|webp);base64 URL, else None."""
    match = _DATA_URL.match(value or "")
    if not match:
        return None
    try:
        return base64.b64decode(re.sub(r"\s", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        return None


def validate_logo_value(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith("data:"):
        data = decode_data_url(value)
        if data is None:
            raise serializers.ValidationError("Upload a PNG, JPEG or WebP image.")
        if len(data) > MAX_LOGO_BYTES:
            raise serializers.ValidationError("Logo image must be under 600 KB.")
        return value
    try:
        URLValidator(schemes=["https"])(value)
    except DjangoValidationError:
        raise serializers.ValidationError("Use an https:// image link or upload an image.") from None
    if len(value) > 2000:
        raise serializers.ValidationError("Logo link is too long.")
    return value


def validate_white_label_config(value) -> dict:
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise serializers.ValidationError("Expected an object.")
    for key in _COLOR_KEYS:
        color = value.get(key)
        if color not in (None, "") and not (isinstance(color, str) and _HEX_COLOR.match(color)):
            raise serializers.ValidationError({key: "Use a hex colour like #0f766e."})
    for key, limit in _TEXT_LIMITS.items():
        text = value.get(key)
        if text not in (None, "") and (not isinstance(text, str) or len(text) > limit):
            raise serializers.ValidationError({key: f"Must be text of at most {limit} characters."})
    return value


def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def load_logo_bytes(value: str) -> bytes | None:
    """Logo image bytes for the PDF renderer, or None. Inline uploads are
    decoded directly; https links are fetched only from public addresses
    (no redirects, short timeout, size-capped) so an agency-set URL can't
    make the server reach internal services."""
    if not value:
        return None
    if value.startswith("data:"):
        return decode_data_url(value)
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or not _is_public_host(parsed.hostname):
        return None
    try:
        with requests.get(value, timeout=4, stream=True, allow_redirects=False) as response:
            if response.status_code != 200:
                return None
            chunks, total = [], 0
            for chunk in response.iter_content(64 * 1024):
                total += len(chunk)
                if total > MAX_LOGO_BYTES * 2:
                    return None
                chunks.append(chunk)
            return b"".join(chunks)
    except requests.RequestException:
        return None
