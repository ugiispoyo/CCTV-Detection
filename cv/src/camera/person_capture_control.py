from __future__ import annotations

import logging
import threading

import httpx

from src.clients.api_client import (
    APIAuthenticationError,
    APIClient,
    CameraConfigurationError,
)
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)


class PersonCaptureRecordingControl:
    """Thread-safe switch for image capture while counting stays live."""

    def __init__(self, enabled: bool) -> None:
        self._enabled = threading.Event()
        if enabled:
            self._enabled.set()

    def is_enabled(self) -> bool:
        return self._enabled.is_set()

    def set_enabled(self, enabled: bool) -> bool:
        previous = self._enabled.is_set()
        if enabled:
            self._enabled.set()
        else:
            self._enabled.clear()
        return previous != enabled


class PersonCaptureRecordingControlService:
    """Poll the API for per-camera capture changes without restarting CV."""

    def __init__(
        self,
        api: APIClient,
        camera_id: str,
        control: PersonCaptureRecordingControl,
        interval_seconds: float,
        stop_event: threading.Event,
    ) -> None:
        self._api = api
        self._camera_id = camera_id
        self._control = control
        self._interval = interval_seconds
        self._stop_event = stop_event
        self._thread = threading.Thread(
            target=self._run,
            name=f"recording-control-{camera_id}",
            daemon=True,
        )

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float = 10) -> None:
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning(
                "Person capture recording control did not stop camera_id=%s",
                self._camera_id,
            )

    def _refresh(self) -> None:
        try:
            config = self._api.get_camera_config(self._camera_id)
            enabled = bool(config.get("personCaptureRecordingEnabled", True))
            if self._control.set_enabled(enabled):
                LOGGER.info(
                    "Person capture recording state changed camera_id=%s enabled=%s",
                    self._camera_id,
                    enabled,
                )
        except (httpx.HTTPError, APIAuthenticationError, CameraConfigurationError) as exc:
            LOGGER.warning(
                "Person capture recording state refresh failed camera_id=%s error=%s",
                self._camera_id,
                sanitize_error(exc),
            )

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self._refresh()
            self._stop_event.wait(self._interval)
