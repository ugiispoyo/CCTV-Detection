from __future__ import annotations

import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

from src.clients.api_client import DetectionEventPayload, PersonCapturePayload
from src.person_capture.cropper import crop_person, crop_region, encode_jpeg
from src.person_capture.head_detector import HeadDetector
from src.person_capture.quality_filter import quality_score
from src.person_capture.snapshot_manager import SnapshotManager
from src.queue.snapshot_queue import SnapshotQueue
from src.tracking.tracker import TrackedObject

LOGGER = logging.getLogger(__name__)


@dataclass
class Candidate:
    full_body: np.ndarray
    confidence: float
    score: float
    captured_at: datetime
    observed_at: float


@dataclass
class CandidateSet:
    candidates: list[Candidate]
    last_seen: float


class PersonCaptureManager:
    """Buffer person crops, but finalize them only after the official line-crossing event."""

    def __init__(
        self, camera_id: str, line_id: str, queue: SnapshotQueue, storage: SnapshotManager,
        head_detector: HeadDetector, full_body_enabled: bool, head_enabled: bool,
        capture_direction: str,
        min_confidence: float, min_width: int, min_height: int, padding: float,
        jpeg_quality: int, max_candidates: int, buffer_seconds: float, max_file_bytes: int,
        head_padding: float, head_min_width: int, head_min_height: int,
    ) -> None:
        self._camera_id, self._line_id = camera_id, line_id
        self._queue, self._storage, self._head_detector = queue, storage, head_detector
        self._full_body_enabled, self._head_enabled = full_body_enabled, head_enabled
        self._capture_direction = capture_direction
        self._min_confidence, self._min_width, self._min_height = min_confidence, min_width, min_height
        self._padding, self._jpeg_quality = padding, jpeg_quality
        self._max_candidates, self._buffer_seconds, self._max_file_bytes = max_candidates, buffer_seconds, max_file_bytes
        self._head_padding, self._head_min_width, self._head_min_height = head_padding, head_min_width, head_min_height
        self._session_id = ""
        self._pending: dict[int, CandidateSet] = {}
        self._crossings: dict[int, DetectionEventPayload] = {}
        self._finalized: OrderedDict[str, None] = OrderedDict()
        self._max_finalized_keys = 20_000

    def reset(self, session_id: str) -> None:
        self._session_id = session_id
        self._pending.clear()
        self._crossings.clear()
        self._finalized.clear()

    def _remember_finalized(self, crossing_id: str) -> None:
        self._finalized[crossing_id] = None
        self._finalized.move_to_end(crossing_id)
        while len(self._finalized) > self._max_finalized_keys:
            self._finalized.popitem(last=False)

    def process(
        self, frame: np.ndarray, tracks: list[TrackedObject], session_id: str,
        crossing_events: list[DetectionEventPayload],
    ) -> None:
        if session_id != self._session_id:
            self.reset(session_id)
        now = time.monotonic()
        visible_ids: set[int] = set()
        for track in tracks:
            if track.object_type != "person":
                continue
            visible_ids.add(track.track_id)
            x1, y1, x2, y2 = track.bbox
            candidate_set = self._pending.setdefault(track.track_id, CandidateSet([], now))
            candidate_set.last_seen = now
            candidate_set.candidates = [item for item in candidate_set.candidates if now - item.observed_at <= self._buffer_seconds]
            if track.confidence < self._min_confidence or x2 - x1 < self._min_width or y2 - y1 < self._min_height:
                continue
            result = crop_person(frame, track.bbox, self._padding)
            if result is None:
                continue
            crop, visible_ratio = result
            if visible_ratio < 0.70:
                continue
            candidate_set.candidates.append(Candidate(
                crop, track.confidence, quality_score(crop, visible_ratio, frame.shape),
                datetime.now(timezone.utc), now,
            ))
            candidate_set.candidates.sort(key=lambda item: item.score, reverse=True)
            del candidate_set.candidates[self._max_candidates:]

        for event in crossing_events:
            direction_allowed = self._capture_direction == "both" or event.direction == self._capture_direction
            if event.objectType == "person" and direction_allowed and event.eventId not in self._finalized:
                self._crossings[event.trackId] = event
        for track_id, event in list(self._crossings.items()):
            self._finalize(track_id, event)
        for track_id, candidate_set in list(self._pending.items()):
            if track_id not in visible_ids and now - candidate_set.last_seen > self._buffer_seconds:
                self._pending.pop(track_id, None)
                self._crossings.pop(track_id, None)

    def _finalize(self, track_id: int, crossing: DetectionEventPayload) -> None:
        if self._queue.at_capacity() or not self._full_body_enabled:
            return
        candidate_set = self._pending.get(track_id)
        if not candidate_set or not candidate_set.candidates or crossing.eventId in self._finalized:
            LOGGER.warning("Crossing capture unavailable camera_id=%s track_id=%d reason=no_valid_candidate", self._camera_id, track_id)
            self._crossings.pop(track_id, None)
            self._remember_finalized(crossing.eventId)
            return
        best = candidate_set.candidates[0]
        full_body = encode_jpeg(best.full_body, self._jpeg_quality, self._max_file_bytes)
        if full_body is None:
            LOGGER.warning("Crossing capture rejected camera_id=%s track_id=%d reason=full_body_size", self._camera_id, track_id)
            self._pending.pop(track_id, None)
            self._crossings.pop(track_id, None)
            self._remember_finalized(crossing.eventId)
            return
        head: bytes | None = None
        if self._head_enabled and self._head_detector.available:
            head_bounds = self._head_detector.detect(best.full_body)
            if head_bounds is not None:
                head_crop = crop_region(best.full_body, head_bounds, self._head_padding, self._head_min_width, self._head_min_height)
                if head_crop is not None:
                    head = encode_jpeg(head_crop, self._jpeg_quality, self._max_file_bytes)
            if head is None:
                LOGGER.info("Head crop unavailable camera_id=%s track_id=%d reason=no_reliable_head", self._camera_id, track_id)
        capture_id = str(uuid.uuid4())
        full_body_path = None
        head_path = None
        try:
            full_body_path = self._storage.save(self._camera_id, capture_id, "full-body", full_body, best.captured_at)
            if head is not None:
                head_path = self._storage.save(self._camera_id, capture_id, "head", head, best.captured_at)
            payload = PersonCapturePayload(
                captureId=capture_id, cameraId=self._camera_id, sessionId=self._session_id,
                trackId=track_id, crossingId=crossing.eventId, lineId=self._line_id,
                direction=crossing.direction,
                objectType="person", confidence=best.confidence, capturedAt=best.captured_at,
            )
            if not self._queue.enqueue(payload, full_body_path, head_path):
                self._storage.remove(full_body_path)
                if head_path is not None:
                    self._storage.remove(head_path)
            else:
                LOGGER.info("Line-triggered person capture queued capture_id=%s camera_id=%s track_id=%d line_id=%s", capture_id, self._camera_id, track_id, self._line_id)
            self._pending.pop(track_id, None)
            self._crossings.pop(track_id, None)
            self._remember_finalized(crossing.eventId)
        except Exception:
            for path in (full_body_path, head_path):
                if path is not None:
                    try:
                        self._storage.remove(path)
                    except OSError:
                        pass
            LOGGER.exception("Person capture storage failed camera_id=%s track_id=%d", self._camera_id, track_id)
