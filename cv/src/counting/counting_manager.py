from __future__ import annotations

import logging
import uuid
from collections import Counter
from datetime import datetime, timezone

from src.clients.api_client import DetectionEventPayload
from src.counting.line_counter import LineCounter
from src.tracking.tracker import TrackedObject

LOGGER = logging.getLogger(__name__)


class CountingManager:
    def __init__(self, camera_id: str, line_counter: LineCounter) -> None:
        self._camera_id = camera_id
        self.line_counter = line_counter
        self.counters: Counter[tuple[str, str]] = Counter()

    def reset_tracking(self) -> None:
        self.line_counter.reset()

    def process(
        self,
        tracks: list[TrackedObject],
        frame_shape: tuple[int, ...],
        session_id: str,
    ) -> list[DetectionEventPayload]:
        events: list[DetectionEventPayload] = []
        countable_tracks = [track for track in tracks if track.object_type in {"person", "car", "motorcycle"}]
        for crossing in self.line_counter.update(countable_tracks, frame_shape):
            event = DetectionEventPayload(
                eventId=str(uuid.uuid4()),
                cameraId=self._camera_id,
                sessionId=session_id,
                trackId=crossing.track.track_id,
                objectType=crossing.track.object_type,
                direction=crossing.direction,
                confidence=crossing.track.confidence,
                timestamp=datetime.now(timezone.utc),
            )
            self.counters[(crossing.track.object_type, crossing.direction)] += 1
            events.append(event)
            LOGGER.info(
                "Line crossing event_id=%s track_id=%d object=%s direction=%s session_id=%s",
                event.eventId,
                event.trackId,
                event.objectType,
                event.direction,
                event.sessionId,
            )
        return events
