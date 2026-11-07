from __future__ import annotations

import asyncio
import json
import logging
import struct
import threading
from dataclasses import dataclass

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

from src.preview.encoder import EncodedPreviewFrame
from src.utils.logger import sanitize_error

LOGGER = logging.getLogger(__name__)
HEADER = struct.Struct(">4sBBHQQHHI")
MAGIC = b"CCTV"
PROTOCOL_VERSION = 1


@dataclass(frozen=True)
class PendingFrame:
    sequence: int
    frame: EncodedPreviewFrame
    object_counts: dict[str, int]
    tracks: list[dict[str, object]]
    session_id: str


class PreviewPublisher:
    """Latest-frame-only WebSocket publisher isolated from the inference loop."""

    def __init__(
        self,
        url: str,
        token: str,
        camera_id: str,
        worker_id: str,
        reconnect_initial: float,
        reconnect_max: float,
        stop_event: threading.Event,
    ) -> None:
        self._url = url
        self._token = token
        self._camera_id = camera_id
        self._worker_id = worker_id
        self._reconnect_initial = reconnect_initial
        self._reconnect_max = reconnect_max
        self._stop_event = stop_event
        self._lock = threading.Lock()
        self._latest: PendingFrame | None = None
        self._sequence = 0
        self._dropped = 0
        self._thread = threading.Thread(target=self._thread_main, name="preview-publisher", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def submit(self, frame: EncodedPreviewFrame, object_counts: dict[str, int], tracks: list[dict[str, object]], session_id: str) -> None:
        with self._lock:
            if self._latest is not None:
                self._dropped += 1
            self._sequence += 1
            self._latest = PendingFrame(self._sequence, frame, dict(object_counts), list(tracks), session_id)

    def join(self, timeout: float = 10) -> None:
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning("Preview publisher did not stop before timeout")

    def dropped_frames(self) -> int:
        with self._lock:
            return self._dropped

    def _take_latest(self) -> PendingFrame | None:
        with self._lock:
            frame = self._latest
            self._latest = None
            return frame

    @staticmethod
    def _packet(pending: PendingFrame) -> bytes:
        frame = pending.frame
        header = HEADER.pack(
            MAGIC,
            PROTOCOL_VERSION,
            0,
            HEADER.size,
            pending.sequence,
            frame.timestamp_ms,
            frame.width,
            frame.height,
            len(frame.jpeg),
        )
        return header + frame.jpeg

    async def _session(self) -> None:
        async with connect(
            self._url,
            additional_headers={"Authorization": f"Bearer {self._token}"},
            open_timeout=10,
            close_timeout=3,
            max_size=64 * 1024,
            ping_interval=20,
            ping_timeout=10,
        ) as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "type": "preview.register",
                        "version": PROTOCOL_VERSION,
                        "cameraId": self._camera_id,
                        "workerId": self._worker_id,
                    }
                )
            )
            response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=10))
            if response.get("type") != "preview.registered":
                raise RuntimeError(f"preview registration rejected: {response.get('code', 'unknown')}")
            LOGGER.info("Preview publisher connected camera_id=%s", self._camera_id)
            while not self._stop_event.is_set():
                pending = self._take_latest()
                if pending is None:
                    await asyncio.sleep(0.02)
                    continue
                await websocket.send(json.dumps({
                    "type": "preview.objects",
                    "version": PROTOCOL_VERSION,
                    "sequence": pending.sequence,
                    "timestamp": pending.frame.timestamp_ms,
                    "counts": pending.object_counts,
                    "tracks": pending.tracks,
                    "sessionId": pending.session_id,
                }, separators=(",", ":")))
                await websocket.send(self._packet(pending))

    async def _run(self) -> None:
        delay = self._reconnect_initial
        while not self._stop_event.is_set():
            try:
                await self._session()
                delay = self._reconnect_initial
            except (ConnectionClosed, InvalidHandshake, OSError, TimeoutError, RuntimeError) as exc:
                if self._stop_event.is_set():
                    break
                LOGGER.warning(
                    "Preview publisher disconnected retry_in=%.1fs error=%s",
                    delay,
                    sanitize_error(exc),
                )
                remaining = delay
                while remaining > 0 and not self._stop_event.is_set():
                    pause = min(0.25, remaining)
                    await asyncio.sleep(pause)
                    remaining -= pause
                delay = min(self._reconnect_max, delay * 2)
        with self._lock:
            dropped = self._dropped
            self._latest = None
        LOGGER.info("Preview publisher stopped dropped_frames=%d", dropped)

    def _thread_main(self) -> None:
        asyncio.run(self._run())

