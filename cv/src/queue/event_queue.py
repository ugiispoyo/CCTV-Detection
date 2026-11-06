from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from src.clients.api_client import DetectionEventPayload
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class QueuedEvent:
    event: DetectionEventPayload
    attempts: int


class EventQueue:
    """Thread-safe SQLite queue shared by inference and the delivery thread."""

    def __init__(self, path: Path, max_pending: int, retain_delivered: bool) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._max_pending = max_pending
        self._retain_delivered = retain_delivered
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(path, timeout=5, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=NORMAL")
            self._connection.execute("PRAGMA busy_timeout=5000")
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'invalid')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_retry_at REAL NOT NULL,
                    last_error TEXT,
                    created_at REAL NOT NULL,
                    delivered_at REAL
                )
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_delivery ON events(status, next_retry_at, created_at)"
            )
            self._connection.commit()

    def enqueue(self, event: DetectionEventPayload) -> bool:
        """Persist before delivery. Returns False only when the UUID was already queued."""
        payload = json.dumps(event.wire_dict(), separators=(",", ":"), sort_keys=True)
        now = time.time()
        with self._lock, self._connection:
            cursor = self._connection.execute(
                """
                INSERT OR IGNORE INTO events
                    (event_id, payload_json, status, attempts, next_retry_at, created_at)
                VALUES (?, ?, 'pending', 0, ?, ?)
                """,
                (event.eventId, payload, now, now),
            )
        return cursor.rowcount == 1

    def get_due(self) -> QueuedEvent | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT payload_json, attempts FROM events
                WHERE status = 'pending' AND next_retry_at <= ?
                ORDER BY created_at ASC LIMIT 1
                """,
                (time.time(),),
            ).fetchone()
        if row is None:
            return None
        return QueuedEvent(
            event=DetectionEventPayload.model_validate_json(row["payload_json"]),
            attempts=int(row["attempts"]),
        )

    def mark_delivered(self, event_id: str) -> None:
        with self._lock, self._connection:
            if self._retain_delivered:
                self._connection.execute(
                    "UPDATE events SET status='delivered', delivered_at=?, last_error=NULL WHERE event_id=?",
                    (time.time(), event_id),
                )
            else:
                self._connection.execute("DELETE FROM events WHERE event_id=?", (event_id,))

    def mark_invalid(self, event_id: str, error: object) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE events SET status='invalid', attempts=attempts+1, last_error=? WHERE event_id=?",
                (sanitize_error(error), event_id),
            )

    def reschedule(self, event_id: str, delay_seconds: float, error: object) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                UPDATE events
                SET attempts=attempts+1, next_retry_at=?, last_error=?
                WHERE event_id=? AND status='pending'
                """,
                (time.time() + delay_seconds, sanitize_error(error), event_id),
            )

    def pending_count(self) -> int:
        with self._lock:
            row = self._connection.execute(
                "SELECT COUNT(*) AS count FROM events WHERE status='pending'"
            ).fetchone()
        return int(row["count"])

    def invalid_count(self) -> int:
        with self._lock:
            row = self._connection.execute(
                "SELECT COUNT(*) AS count FROM events WHERE status='invalid'"
            ).fetchone()
        return int(row["count"])

    def outstanding_count(self) -> int:
        with self._lock:
            row = self._connection.execute(
                "SELECT COUNT(*) AS count FROM events WHERE status IN ('pending', 'invalid')"
            ).fetchone()
        return int(row["count"])

    def at_capacity(self) -> bool:
        return self.outstanding_count() >= self._max_pending

    def close(self) -> None:
        with self._lock:
            self._connection.close()
