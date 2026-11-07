from __future__ import annotations

from collections.abc import Mapping

import cv2
import numpy as np

from src.counting.line_counter import LineCounter
from src.tracking.tracker import TrackedObject

COLORS: dict[str, tuple[int, int, int]] = {
    "person": (180, 60, 180),
    "car": (60, 180, 75),
    "motorcycle": (230, 120, 40),
    "head": (40, 190, 230),
}


class PreviewRenderer:
    """Render the existing tracker and counter state without changing either."""

    def __init__(self, camera_id: str, line_counter: LineCounter, in_mapping: str) -> None:
        self._camera_id = camera_id
        self._line_counter = line_counter
        self._in_mapping = in_mapping

    def render(
        self,
        frame: np.ndarray,
        tracks: list[TrackedObject],
        counters: Mapping[tuple[str, str], int],
        processing_fps: float,
        connected: bool,
    ) -> np.ndarray:
        output = frame.copy()
        for track in tracks:
            if track.object_type not in COLORS:
                continue
            x1, y1, x2, y2 = (int(value) for value in track.bbox)
            color = COLORS[track.object_type]
            cv2.rectangle(output, (x1, y1), (x2, y2), color, 2)
            label = f"{track.object_type.upper()} #{track.track_id} {track.confidence:.0%}"
            (label_width, label_height), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2
            )
            label_x = max(0, min(x1, output.shape[1] - label_width - 8))
            label_y = max(label_height + baseline + 5, y1)
            cv2.rectangle(
                output,
                (label_x, label_y - label_height - baseline - 5),
                (label_x + label_width + 8, label_y + 3),
                color,
                -1,
            )
            cv2.putText(
                output,
                label,
                (label_x + 4, label_y - baseline),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

        x1, y1, x2, y2 = self._line_counter.pixel_line(output.shape)
        cv2.line(output, (int(x1), int(y1)), (int(x2), int(y2)), (0, 220, 255), 3)
        direction = "IN: - to +" if self._in_mapping == "negative_to_positive" else "IN: + to -"
        cv2.putText(
            output,
            direction,
            (max(8, int(x1)), max(22, int(y1) - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 220, 255),
            2,
            cv2.LINE_AA,
        )

        status = "ONLINE" if connected else "OFFLINE"
        cv2.putText(
            output,
            f"{self._camera_id} | {status} | {processing_fps:.1f} FPS",
            (16, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        y = 54
        for object_type in ("person", "car", "motorcycle"):
            incoming = counters.get((object_type, "in"), 0)
            outgoing = counters.get((object_type, "out"), 0)
            cv2.putText(
                output,
                f"{object_type.upper()}: IN {incoming} / OUT {outgoing}",
                (16, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.52,
                COLORS[object_type],
                2,
                cv2.LINE_AA,
            )
            y += 24
        return output

