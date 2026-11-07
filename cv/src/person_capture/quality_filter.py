from __future__ import annotations

import cv2
import numpy as np


def quality_score(crop: np.ndarray, visible_ratio: float, frame_shape: tuple[int, ...]) -> float:
    """Rank capture quality using geometry and sharpness only; no identity inference."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    sharpness = min(float(cv2.Laplacian(gray, cv2.CV_64F).var()) / 500.0, 1.0)
    frame_area = max(frame_shape[0] * frame_shape[1], 1)
    size_score = min((crop.shape[0] * crop.shape[1]) / (frame_area * 0.18), 1.0)
    return (visible_ratio * 0.35) + (sharpness * 0.40) + (size_score * 0.25)
