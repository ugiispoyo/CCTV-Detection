from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from src.camera.rtsp import RTSPCapture
from src.camera.worker import CameraWorker
from src.monitoring.heartbeat import HeartbeatService
from src.preview.publisher import PreviewPublisher

LOGGER = logging.getLogger(__name__)


@dataclass
class CameraRuntime:
    camera_id: str
    capture: RTSPCapture
    worker: CameraWorker
    heartbeat: HeartbeatService
    preview_publisher: PreviewPublisher | None
    worker_thread: threading.Thread


class CameraManager:
    """Own all independent logical-camera runtimes in one CV process."""

    def __init__(self, runtimes: list[CameraRuntime], stop_event: threading.Event) -> None:
        self._runtimes = runtimes
        self._stop_event = stop_event

    def run(self) -> None:
        reported_stopped: set[str] = set()
        for runtime in self._runtimes:
            runtime.capture.start()
            runtime.heartbeat.start()
            if runtime.preview_publisher is not None:
                runtime.preview_publisher.start()
            runtime.worker_thread.start()
            LOGGER.info("Logical camera runtime started camera_id=%s", runtime.camera_id)
        try:
            while not self._stop_event.wait(0.5):
                for runtime in self._runtimes:
                    if not runtime.worker_thread.is_alive() and runtime.camera_id not in reported_stopped:
                        LOGGER.error("Camera worker stopped unexpectedly camera_id=%s", runtime.camera_id)
                        reported_stopped.add(runtime.camera_id)
        finally:
            self._stop_event.set()
            for runtime in self._runtimes:
                runtime.capture.release()

    def join(self) -> None:
        for runtime in self._runtimes:
            runtime.worker_thread.join(timeout=15)
            runtime.capture.join()
            runtime.heartbeat.join()
            if runtime.preview_publisher is not None:
                runtime.preview_publisher.join()
            LOGGER.info("Logical camera runtime stopped camera_id=%s", runtime.camera_id)
