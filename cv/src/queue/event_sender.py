from __future__ import annotations

import email.utils
import logging
import random
import threading
import time
from datetime import datetime, timezone

import httpx

from src.clients.api_client import APIClient
from src.queue.event_queue import EventQueue, QueuedEvent
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)


class EventSender:
    def __init__(
        self,
        queue: EventQueue,
        api_client: APIClient,
        stop_event: threading.Event,
        retry_initial: float,
        retry_max: float,
    ) -> None:
        self._queue = queue
        self._api = api_client
        self._stop_event = stop_event
        self._retry_initial = retry_initial
        self._retry_max = retry_max
        self._thread = threading.Thread(target=self._run, name="event-sender", daemon=True)
        self._authentication_pause_until = 0.0

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float = 10) -> None:
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning("Event sender did not stop before shutdown timeout")

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
                retry_time = email.utils.parsedate_to_datetime(value)
                return max((retry_time - datetime.now(timezone.utc)).total_seconds(), 0.5)
            except (TypeError, ValueError):
                return fallback

    def _deliver(self, queued: QueuedEvent) -> None:
        event_id = queued.event.eventId
        try:
            response = self._api.post_event(queued.event)
        except httpx.HTTPError as exc:
            delay = self._retry_delay(queued.attempts)
            self._queue.reschedule(event_id, delay, exc)
            LOGGER.warning("Event delivery failed event_id=%s retry_in=%.1fs error=%s", event_id, delay, sanitize_error(exc))
            return

        if 200 <= response.status_code < 300:
            self._queue.mark_delivered(event_id)
            duplicate = False
            try:
                duplicate = bool(response.json().get("data", {}).get("duplicate"))
            except ValueError:
                pass
            LOGGER.info("Event delivered event_id=%s duplicate=%s", event_id, duplicate)
            return

        message = f"Fastify returned HTTP {response.status_code}"
        if response.status_code == 429:
            delay = self._retry_after(response.headers.get("Retry-After"), self._retry_delay(queued.attempts))
            self._queue.reschedule(event_id, delay, message)
            LOGGER.warning("Event rate limited event_id=%s retry_in=%.1fs", event_id, delay)
        elif response.status_code >= 500:
            delay = self._retry_delay(queued.attempts)
            self._queue.reschedule(event_id, delay, message)
            LOGGER.warning("Fastify unavailable event_id=%s status=%d retry_in=%.1fs", event_id, response.status_code, delay)
        elif response.status_code in (401, 403):
            delay = self._retry_max
            self._authentication_pause_until = time.monotonic() + delay
            self._queue.reschedule(event_id, delay, message)
            LOGGER.error("Event delivery authentication rejected; retries paused for %.0fs", delay)
        else:
            # 400/422 are invalid payloads. 404/409 mean missing/inactive camera in this API.
            # No 409 response is treated as an idempotent success.
            self._queue.mark_invalid(event_id, message)
            LOGGER.error("Event permanently rejected event_id=%s status=%d", event_id, response.status_code)

    def _run(self) -> None:
        LOGGER.info("Event sender started pending=%d", self._queue.pending_count())
        while not self._stop_event.is_set():
            if time.monotonic() < self._authentication_pause_until:
                self._stop_event.wait(1)
                continue
            queued = self._queue.get_due()
            if queued is None:
                self._stop_event.wait(0.5)
                continue
            self._deliver(queued)
        LOGGER.info("Event sender stopped pending=%d", self._queue.pending_count())
