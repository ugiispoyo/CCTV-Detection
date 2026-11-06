from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class EncodedPreviewFrame:
    jpeg: bytes
    width: int
    height: int
    timestamp_ms: int
    encoding_latency_ms: float


class JpegPreviewEncoder:
    def __init__(self, target_width: int, quality: int, max_bytes: int) -> None:
        self._target_width = target_width
        self._quality = quality
        self._max_bytes = max_bytes

    def encode(self, frame: np.ndarray) -> EncodedPreviewFrame | None:
        started = time.perf_counter()
        height, width = frame.shape[:2]
        if width > self._target_width:
            scale = self._target_width / width
            width = self._target_width
            height = max(1, round(height * scale))
            frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(
            ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self._quality]
        )
        if not ok:
            return None
        payload = encoded.tobytes()
        if len(payload) > self._max_bytes:
            return None
        return EncodedPreviewFrame(
            jpeg=payload,
            width=width,
            height=height,
            timestamp_ms=int(time.time() * 1000),
            encoding_latency_ms=(time.perf_counter() - started) * 1000,
        )

