from __future__ import annotations

import email.utils
import logging
import random
import threading
import time
from datetime import datetime, timezone

import httpx

from src.clients.api_client import APIClient
from src.person_capture.snapshot_manager import SnapshotManager
from src.queue.snapshot_queue import QueuedSnapshot, SnapshotQueue
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)


class SnapshotSender:
    def __init__(self, queue: SnapshotQueue, storage: SnapshotManager, api: APIClient,
                 stop_event: threading.Event, retry_initial: float, retry_max: float,
                 retention_days: int) -> None:
        self._queue, self._storage, self._api = queue, storage, api
        self._stop_event = stop_event
        self._retry_initial, self._retry_max = retry_initial, retry_max
        self._retention_days = retention_days
        self._thread = threading.Thread(target=self._run, name="snapshot-sender", daemon=True)
        self._authentication_pause_until = 0.0

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float = 10) -> None:
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning("Snapshot sender did not stop before shutdown timeout")

    def _retry_delay(self, attempts: int) -> float:
        base = min(self._retry_max, self._retry_initial * (2 ** min(attempts, 10)))
        return base + random.uniform(0, base * 0.2)

    @staticmethod
    def _retry_after(value: str | None, fallback: float) -> float:
        if not value:
            return fallback
        try:
            return max(float(value), 0.5)
        except ValueError:
            try:
                return max((email.utils.parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds(), 0.5)
            except (TypeError, ValueError):
                return fallback

    @staticmethod
    def _response_error(response: httpx.Response) -> str:
        """Keep actionable API diagnostics without persisting response bodies."""
        try:
            error = response.json().get("error", {})
            code = str(error.get("code", "API_REJECTED"))
            message = str(error.get("message", "Request rejected"))
            return sanitize_error(f"HTTP {response.status_code} {code}: {message}")
        except (ValueError, AttributeError, TypeError):
            return f"HTTP {response.status_code}"

    def _deliver(self, queued: QueuedSnapshot) -> None:
        capture_id = queued.capture.captureId
        if not queued.full_body_path.is_file() or (queued.head_path is not None and not queued.head_path.is_file()):
            self._queue.mark_invalid(capture_id, "Snapshot file is missing")
            LOGGER.error("Snapshot delivery permanently stopped capture_id=%s reason=file_missing", capture_id)
            return
        try:
            response = self._api.post_person_capture(queued.capture, queued.full_body_path, queued.head_path)
        except (httpx.HTTPError, OSError) as exc:
            delay = self._retry_delay(queued.attempts)
            self._queue.reschedule(capture_id, delay, exc)
            LOGGER.warning("Snapshot delivery failed capture_id=%s retry_in=%.1fs error=%s", capture_id, delay, sanitize_error(exc))
            return
        if 200 <= response.status_code < 300:
            self._queue.mark_delivered(capture_id)
            for path in (queued.full_body_path, queued.head_path):
                if path is not None:
                    try:
                        self._storage.remove(path)
                    except OSError as exc:
                        LOGGER.warning("Acknowledged snapshot cleanup deferred capture_id=%s error=%s", capture_id, sanitize_error(exc))
            LOGGER.info("Person capture delivered capture_id=%s", capture_id)
        elif response.status_code == 429:
            delay = self._retry_after(response.headers.get("Retry-After"), self._retry_delay(queued.attempts))
            self._queue.reschedule(capture_id, delay, self._response_error(response))
        elif response.status_code >= 500:
            delay = self._retry_delay(queued.attempts)
            self._queue.reschedule(capture_id, delay, self._response_error(response))
        elif response.status_code in (401, 403):
            self._authentication_pause_until = time.monotonic() + self._retry_max
            self._queue.reschedule(capture_id, self._retry_max, self._response_error(response))
            LOGGER.error("Snapshot authentication rejected; retries paused for %.0fs", self._retry_max)
        else:
            reason = self._response_error(response)
            self._queue.mark_invalid(capture_id, reason)
            LOGGER.error("Snapshot permanently rejected capture_id=%s error=%s", capture_id, reason)

    def _run(self) -> None:
        LOGGER.info("Snapshot sender started pending_or_invalid=%d", self._queue.outstanding_count())
        next_cleanup = 0.0
        while not self._stop_event.is_set():
            if time.monotonic() >= next_cleanup:
                removed = self._storage.cleanup_orphans(self._queue.referenced_paths(), self._retention_days)
                if removed:
                    LOGGER.info("Expired orphan snapshots removed count=%d", removed)
                next_cleanup = time.monotonic() + 3600
            if time.monotonic() < self._authentication_pause_until:
                self._stop_event.wait(1)
                continue
            queued = self._queue.get_due()
            if queued is None:
                self._stop_event.wait(0.5)
                continue
            self._deliver(queued)
        LOGGER.info("Snapshot sender stopped pending_or_invalid=%d", self._queue.outstanding_count())
