from __future__ import annotations

import logging
import re
import sys
from urllib.parse import urlsplit, urlunsplit


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )


def sanitize_rtsp_url(value: str) -> str:
    """Remove credentials and query values before an RTSP URL reaches a log."""
    try:
        parts = urlsplit(value)
        host = parts.hostname or "unknown-host"
        if parts.port:
            host = f"{host}:{parts.port}"
        return urlunsplit((parts.scheme or "rtsp", host, parts.path, "", ""))
    except ValueError:
        return "rtsp://[invalid-url]"


def sanitize_error(value: object, limit: int = 300) -> str:
    text = str(value)
    text = re.sub(r"(rtsp://)([^@\s/]+)@", r"\1[REDACTED]@", text, flags=re.IGNORECASE)
    text = re.sub(r"(Bearer\s+)[^\s]+", r"\1[REDACTED]", text, flags=re.IGNORECASE)
    return text[:limit]
