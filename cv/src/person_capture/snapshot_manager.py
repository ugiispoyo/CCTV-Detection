from __future__ import annotations

import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

LOGGER = logging.getLogger(__name__)
SAFE_ID = re.compile(r"[^A-Za-z0-9._-]")


class SnapshotManager:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def save(self, camera_id: str, capture_id: str, kind: str, image: bytes, captured_at: datetime) -> Path:
        safe_camera = SAFE_ID.sub("_", camera_id)[:80]
        if kind not in {"full-body", "head"}:
            raise ValueError("Unsupported snapshot kind")
        directory = self._root / safe_camera / f"{captured_at.year:04d}" / f"{captured_at.month:02d}" / capture_id
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination = directory / f"{kind}.jpg"
        file_descriptor, temporary_name = tempfile.mkstemp(prefix=".capture-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(file_descriptor, "wb") as handle:
                handle.write(image)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_name, 0o600)
            os.replace(temporary_name, destination)
            return destination
        except Exception:
            try:
                os.unlink(temporary_name)
            except OSError:
                pass
            raise

    def remove(self, path: Path) -> None:
        resolved = path.resolve()
        if resolved != self._root and self._root not in resolved.parents:
            raise ValueError("Snapshot path escaped configured storage directory")
        resolved.unlink(missing_ok=True)

    def cleanup_orphans(self, referenced_paths: set[Path], retention_days: int) -> int:
        threshold = datetime.now(timezone.utc).timestamp() - retention_days * 86_400
        referenced = {path.resolve() for path in referenced_paths}
        removed = 0
        for path in self._root.rglob("*.jpg"):
            try:
                if path.resolve() not in referenced and path.stat().st_mtime < threshold:
                    self.remove(path)
                    removed += 1
            except OSError as exc:
                LOGGER.warning("Unable to clean orphan snapshot file=%s error=%s", path.name, type(exc).__name__)
        return removed
