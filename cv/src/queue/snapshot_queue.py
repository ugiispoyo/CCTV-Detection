from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from src.clients.api_client import PersonCapturePayload
from src.utils.logger import sanitize_error


@dataclass(frozen=True)
class QueuedSnapshot:
    capture: PersonCapturePayload
    full_body_path: Path
    head_path: Path | None
    attempts: int


class SnapshotQueue:
    def __init__(self, path: Path, max_pending: int) -> None:
        self._max_pending = max_pending
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(path, timeout=5, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA busy_timeout=5000")
            self._connection.execute("""CREATE TABLE IF NOT EXISTS person_snapshots (
                capture_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, image_path TEXT NOT NULL,
                head_path TEXT,
                status TEXT NOT NULL CHECK(status IN ('pending','invalid')), attempts INTEGER NOT NULL DEFAULT 0,
                next_retry_at REAL NOT NULL, last_error TEXT, created_at REAL NOT NULL
            )""")
            self._connection.execute("CREATE INDEX IF NOT EXISTS idx_person_snapshots_delivery ON person_snapshots(status,next_retry_at,created_at)")
            columns = {row[1] for row in self._connection.execute("PRAGMA table_info(person_snapshots)")}
            if "head_path" not in columns:
                self._connection.execute("ALTER TABLE person_snapshots ADD COLUMN head_path TEXT")
            # Phase 4 rows were detection-triggered and lack an authoritative line crossing.
            # Preserve them for diagnosis but never upload them as Phase 4.2 captures.
            for row in self._connection.execute("SELECT capture_id,payload_json FROM person_snapshots").fetchall():
                payload = json.loads(row["payload_json"])
                if "lineId" not in payload or "direction" not in payload or "crossingId" not in payload:
                    self._connection.execute(
                        "UPDATE person_snapshots SET status='invalid',last_error='Legacy pre-line-trigger capture quarantined' WHERE capture_id=?",
                        (row["capture_id"],),
                    )
            # Captures may have reached an older API before the Phase 4 endpoint was
            # deployed. Retry those 404s once after startup; a genuinely unknown
            # camera will be rejected and returned to invalid by the sender.
            self._connection.execute(
                "UPDATE person_snapshots SET status='pending',next_retry_at=?,last_error='Retry after API endpoint upgrade' WHERE status='invalid' AND last_error='HTTP 404'",
                (time.time(),),
            )
            self._connection.commit()

    def enqueue(self, capture: PersonCapturePayload, full_body_path: Path,
                head_path: Path | None = None) -> bool:
        now = time.time()
        with self._lock, self._connection:
            if self.outstanding_count() >= self._max_pending:
                raise RuntimeError("Person capture queue capacity reached; snapshot remains on disk")
            cursor = self._connection.execute(
                "INSERT OR IGNORE INTO person_snapshots(capture_id,payload_json,image_path,head_path,status,next_retry_at,created_at) VALUES(?,?,?,?,'pending',?,?)",
                (capture.captureId, json.dumps(capture.wire_dict(), separators=(",", ":")), str(full_body_path), str(head_path) if head_path else None, now, now),
            )
        return cursor.rowcount == 1

    def get_due(self) -> QueuedSnapshot | None:
        with self._lock:
            row = self._connection.execute("SELECT payload_json,image_path,head_path,attempts FROM person_snapshots WHERE status='pending' AND next_retry_at<=? ORDER BY created_at LIMIT 1", (time.time(),)).fetchone()
        if row is None:
            return None
        return QueuedSnapshot(PersonCapturePayload.model_validate_json(row["payload_json"]), Path(row["image_path"]), Path(row["head_path"]) if row["head_path"] else None, int(row["attempts"]))

    def mark_delivered(self, capture_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute("DELETE FROM person_snapshots WHERE capture_id=?", (capture_id,))

    def mark_invalid(self, capture_id: str, error: object) -> None:
        with self._lock, self._connection:
            self._connection.execute("UPDATE person_snapshots SET status='invalid',attempts=attempts+1,last_error=? WHERE capture_id=?", (sanitize_error(error), capture_id))

    def reschedule(self, capture_id: str, delay: float, error: object) -> None:
        with self._lock, self._connection:
            self._connection.execute("UPDATE person_snapshots SET attempts=attempts+1,next_retry_at=?,last_error=? WHERE capture_id=? AND status='pending'", (time.time()+delay, sanitize_error(error), capture_id))

    def outstanding_count(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) AS count FROM person_snapshots WHERE status IN ('pending','invalid')").fetchone()
        return int(row["count"])

    def at_capacity(self) -> bool:
        return self.outstanding_count() >= self._max_pending

    def referenced_paths(self) -> set[Path]:
        with self._lock:
            rows = self._connection.execute("SELECT image_path,head_path FROM person_snapshots").fetchall()
        return {
            Path(path) for row in rows for path in (row["image_path"], row["head_path"]) if path
        }

    def close(self) -> None:
        with self._lock:
            self._connection.close()
