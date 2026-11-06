from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Callable

import httpx

from src.clients.api_client import APIClient, HeartbeatPayload
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)


def _safe_api_error(response: httpx.Response) -> tuple[str, str]:
    """Extract the platform's public error code/message without logging request secrets."""
    try:
        error = response.json().get("error", {})
        return str(error.get("code", "UNKNOWN")), str(error.get("message", "Request rejected"))[:200]
    except (ValueError, AttributeError):
        return "UNKNOWN", "Request rejected"


class HeartbeatService:
    def __init__(
        self,
        api_client: APIClient,
        worker_id: str,
        camera_id: str,
        is_camera_connected: Callable[[], bool],
        interval_seconds: float,
        stop_event: threading.Event,
    ) -> None:
        self._api = api_client
        self._worker_id = worker_id
        self._camera_id = camera_id
        self._is_camera_connected = is_camera_connected
        self._interval = interval_seconds
        self._stop_event = stop_event
        self._thread = threading.Thread(target=self._run, name="heartbeat", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float = 10) -> None:
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning("Heartbeat service did not stop before shutdown timeout")

    def _send(self) -> None:
        status = "online" if self._is_camera_connected() else "offline"
        heartbeat = HeartbeatPayload(
            workerId=self._worker_id,
            cameraId=self._camera_id,
            status=status,
            timestamp=datetime.now(timezone.utc),
        )
        try:
            response = self._api.post_heartbeat(heartbeat)
            if response.status_code in (401, 403):
                LOGGER.error("Heartbeat authentication rejected status=%d", response.status_code)
            elif response.status_code >= 400:
                code, message = _safe_api_error(response)
                LOGGER.warning(
                    "Heartbeat rejected status=%d code=%s message=%s camera_status=%s",
                    response.status_code,
                    code,
                    message,
                    status,
                )
            else:
                LOGGER.debug("Heartbeat delivered camera_status=%s", status)
        except httpx.HTTPError as exc:
            LOGGER.warning("Heartbeat delivery failed error=%s", sanitize_error(exc))

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self._send()
            self._stop_event.wait(self._interval)
