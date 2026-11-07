from __future__ import annotations

import cv2
import numpy as np


def crop_person(frame: np.ndarray, bbox: tuple[float, float, float, float], padding: float) -> tuple[np.ndarray, float] | None:
    """Return a padded crop and the fraction of its requested area inside the frame."""
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    box_width, box_height = max(x2 - x1, 1), max(y2 - y1, 1)
    requested = (
        x1 - box_width * padding,
        y1 - box_height * padding,
        x2 + box_width * padding,
        y2 + box_height * padding,
    )
    left, top = max(0, int(requested[0])), max(0, int(requested[1]))
    right, bottom = min(width, int(requested[2] + 0.5)), min(height, int(requested[3] + 0.5))
    if right <= left or bottom <= top:
        return None
    requested_area = max((requested[2] - requested[0]) * (requested[3] - requested[1]), 1)
    visible_ratio = ((right - left) * (bottom - top)) / requested_area
    return frame[top:bottom, left:right].copy(), min(max(visible_ratio, 0.0), 1.0)


def crop_region(image: np.ndarray, bbox: tuple[float, float, float, float], padding: float,
                min_width: int, min_height: int) -> np.ndarray | None:
    height, width = image.shape[:2]
    x1, y1, x2, y2 = bbox
    box_width, box_height = x2 - x1, y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None
    left = max(0, int(x1 - box_width * padding))
    top = max(0, int(y1 - box_height * padding))
    right = min(width, int(x2 + box_width * padding + 0.5))
    bottom = min(height, int(y2 + box_height * padding + 0.5))
    # HEAD_CROP_MIN_* applies to the stored, padded crop. Checking the raw
    # detector box here rejected valid small heads even when padding brought
    # the final evidence image above the configured minimum.
    if right <= left or bottom <= top or right - left < min_width or bottom - top < min_height:
        return None
    return image[top:bottom, left:right].copy()


def encode_jpeg(image: np.ndarray, quality: int, max_bytes: int) -> bytes | None:
    """Encode JPEG and progressively lower quality without resizing identity evidence."""
    for candidate_quality in range(quality, 39, -10):
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, candidate_quality])
        if ok and encoded.nbytes <= max_bytes:
            return encoded.tobytes()
    return None
