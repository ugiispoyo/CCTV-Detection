from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class MetricsSnapshot:
    processing_fps: float
    inference_latency_ms: float
    processed_frames: int
    last_frame_monotonic: float | None


class RuntimeMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._started = time.monotonic()
        self._processed_frames = 0
        self._inference_latency_ms = 0.0
        self._last_frame_monotonic: float | None = None

    def record_frame(self, inference_latency_ms: float) -> None:
        with self._lock:
            self._processed_frames += 1
            self._inference_latency_ms = inference_latency_ms
            self._last_frame_monotonic = time.monotonic()

    def snapshot(self) -> MetricsSnapshot:
        with self._lock:
            elapsed = max(time.monotonic() - self._started, 0.001)
            return MetricsSnapshot(
                processing_fps=self._processed_frames / elapsed,
                inference_latency_ms=self._inference_latency_ms,
                processed_frames=self._processed_frames,
                last_frame_monotonic=self._last_frame_monotonic,
            )
