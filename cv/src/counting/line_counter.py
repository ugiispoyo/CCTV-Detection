from __future__ import annotations

import math
import time
from dataclasses import dataclass

from src.tracking.tracker import TrackedObject


@dataclass
class TrackSideState:
    stable_side: int
    last_seen: float
    last_crossed_at: float


@dataclass(frozen=True)
class Crossing:
    track: TrackedObject
    direction: str


class LineCounter:
    """Detect meaningful crossings using signed pixel distance and hysteresis."""

    def __init__(
        self,
        normalized_line: tuple[float, float, float, float],
        margin_pixels: float,
        in_mapping: str,
        anchor: str,
        rearm_seconds: float = 1.5,
    ) -> None:
        self._normalized_line = normalized_line
        self._margin = margin_pixels
        self._in_mapping = in_mapping
        self._anchor = anchor
        self._rearm_seconds = rearm_seconds
        self._states: dict[int, TrackSideState] = {}

    def reset(self) -> None:
        self._states.clear()

    def pixel_line(self, frame_shape: tuple[int, ...]) -> tuple[float, float, float, float]:
        height, width = frame_shape[:2]
        x1, y1, x2, y2 = self._normalized_line
        return x1 * width, y1 * height, x2 * width, y2 * height

    def _anchor_point(self, track: TrackedObject) -> tuple[float, float]:
        x1, y1, x2, y2 = track.bbox
        if self._anchor == "center":
            return (x1 + x2) / 2, (y1 + y2) / 2
        return (x1 + x2) / 2, y2

    @staticmethod
    def _signed_distance(
        point: tuple[float, float], line: tuple[float, float, float, float]
    ) -> float:
        px, py = point
        x1, y1, x2, y2 = line
        length = math.hypot(x2 - x1, y2 - y1)
        return ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) / length

    def update(self, tracks: list[TrackedObject], frame_shape: tuple[int, ...]) -> list[Crossing]:
        now = time.monotonic()
        line = self.pixel_line(frame_shape)
        crossings: list[Crossing] = []
        for track in tracks:
            distance = self._signed_distance(self._anchor_point(track), line)
            side = 1 if distance > self._margin else -1 if distance < -self._margin else 0
            state = self._states.get(track.track_id)
            if state is None:
                if side:
                    self._states[track.track_id] = TrackSideState(side, now, float("-inf"))
                continue
            state.last_seen = now
            if not side:
                continue
            if side != state.stable_side and now - state.last_crossed_at >= self._rearm_seconds:
                transition = "negative_to_positive" if state.stable_side < side else "positive_to_negative"
                direction = "in" if transition == self._in_mapping else "out"
                crossings.append(Crossing(track, direction))
                state.last_crossed_at = now
            state.stable_side = side

        # Preserve brief occlusions while bounding tracker-specific memory.
        stale = [track_id for track_id, state in self._states.items() if now - state.last_seen > 30]
        for track_id in stale:
            self._states.pop(track_id, None)
        return crossings
