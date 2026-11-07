from __future__ import annotations

import logging
import time
import threading
import uuid
from dataclasses import dataclass

import numpy as np

from src.detection.detector import Detector

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class TrackedObject:
    track_id: int
    object_type: str
    confidence: float
    bbox: tuple[float, float, float, float]


class ByteTrackTracker:
    """One independent Ultralytics ByteTrack context for one camera."""

    def __init__(
        self,
        detector: Detector,
        confidence: float,
        iou: float,
        image_size: int,
        inference_lock: threading.Lock | None = None,
    ) -> None:
        self._detector = detector
        self._confidence = confidence
        self._iou = iou
        self._image_size = image_size
        self._inference_lock = inference_lock or threading.Lock()
        self.session_id = str(uuid.uuid4())

    def reset(self) -> None:
        # Discard only the predictor/tracker state; loaded model weights remain cached in memory.
        with self._inference_lock:
            self._detector.model.predictor = None
        self.session_id = str(uuid.uuid4())
        LOGGER.info("ByteTrack state reset session_id=%s", self.session_id)

    def track(self, frame: np.ndarray) -> tuple[list[TrackedObject], float]:
        started = time.perf_counter()
        with self._inference_lock:
            results = self._detector.model.track(
                source=frame,
                persist=True,
                tracker="bytetrack.yaml",
                classes=list(self._detector.object_classes),
                conf=self._confidence,
                iou=self._iou,
                imgsz=self._image_size,
                device=self._detector.device,
                verbose=False,
            )
        latency_ms = (time.perf_counter() - started) * 1000
        if not results:
            return [], latency_ms
        boxes = results[0].boxes
        if boxes is None or not boxes.is_track or boxes.id is None:
            return [], latency_ms
        xyxy = boxes.xyxy.detach().cpu().tolist()
        ids = boxes.id.detach().cpu().int().tolist()
        classes = boxes.cls.detach().cpu().int().tolist()
        confidences = boxes.conf.detach().cpu().tolist()
        tracked = [
            TrackedObject(
                track_id=int(track_id),
                object_type=self._detector.object_classes[int(class_id)],
                confidence=float(confidence),
                bbox=tuple(float(value) for value in bounds),
            )
            for bounds, track_id, class_id, confidence in zip(
                xyxy, ids, classes, confidences, strict=True
            )
            if int(class_id) in self._detector.object_classes
        ]
        return tracked, latency_ms


class HybridByteTrackTracker:
    """Merge independently tracked custom objects and legacy cars into one session."""

    def __init__(self, primary: ByteTrackTracker, car: ByteTrackTracker) -> None:
        self._primary = primary
        self._car = car
        self._global_ids: dict[tuple[str, int], int] = {}
        self._next_global_id = 1
        self.session_id = str(uuid.uuid4())

    def reset(self) -> None:
        self._primary.reset()
        self._car.reset()
        self._global_ids.clear()
        self._next_global_id = 1
        self.session_id = str(uuid.uuid4())
        LOGGER.info("Hybrid tracker state reset session_id=%s", self.session_id)

    def _merge(self, source: str, tracks: list[TrackedObject]) -> list[TrackedObject]:
        merged: list[TrackedObject] = []
        for track in tracks:
            key = (source, track.track_id)
            global_id = self._global_ids.get(key)
            if global_id is None:
                global_id = self._next_global_id
                self._next_global_id += 1
                self._global_ids[key] = global_id
            merged.append(TrackedObject(global_id, track.object_type, track.confidence, track.bbox))
        return merged

    def track(self, frame: np.ndarray) -> tuple[list[TrackedObject], float]:
        primary_tracks, primary_ms = self._primary.track(frame)
        car_tracks, car_ms = self._car.track(frame)
        return self._merge("custom", primary_tracks) + self._merge("legacy-car", car_tracks), primary_ms + car_ms
