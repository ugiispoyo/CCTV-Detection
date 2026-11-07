from __future__ import annotations

import logging
import threading
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

LOGGER = logging.getLogger(__name__)


class HeadDetector:
    """Optional, explicit object detector used only on the selected crossing crop."""

    def __init__(self, model_path: Path | None, confidence: float, device: str,
                 allow_opencv_fallback: bool = True) -> None:
        self._confidence = confidence
        self._device = device
        self._model: YOLO | None = None
        self._cascades: list[cv2.CascadeClassifier] = []
        self._lock = threading.Lock()
        self._head_class_ids: set[int] = set()
        if model_path is None:
            if allow_opencv_fallback:
                cascade_paths = [
                    Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml",
                    Path(cv2.data.haarcascades) / "haarcascade_profileface.xml",
                ]
                self._cascades = [cv2.CascadeClassifier(str(path)) for path in cascade_paths]
                self._cascades = [cascade for cascade in self._cascades if not cascade.empty()]
                if self._cascades:
                    LOGGER.info("Head crop using bundled OpenCV frontal/profile detector fallback")
                    return
            LOGGER.warning("Head crop unavailable: no configured detector and OpenCV fallback is disabled or unavailable")
            return
        if not model_path.is_file():
            LOGGER.warning("Head crop unavailable: configured detector file does not exist")
            return
        model = YOLO(str(model_path))
        names = model.names
        self._head_class_ids = {
            int(class_id) for class_id, name in names.items() if str(name).strip().lower() == "head"
        }
        if not self._head_class_ids and len(names) == 1:
            # Some reviewed single-class head checkpoints retain Ultralytics' generic
            # class label even though their sole class is documented as `head`.
            self._head_class_ids = {int(next(iter(names)))}
            LOGGER.warning(
                "Configured single-class head detector has no 'head' class label; "
                "treating its only class as head"
            )
        if not self._head_class_ids:
            raise ValueError("Head detector class mapping must contain a class named 'head'")
        self._model = model
        LOGGER.info("Head detector loaded model=%s head_classes=%s", model_path.name, sorted(self._head_class_ids))

    @property
    def available(self) -> bool:
        return self._model is not None or bool(self._cascades)

    def detect(self, person_crop: np.ndarray) -> tuple[float, float, float, float] | None:
        if self._model is None:
            if not self._cascades:
                return None
            gray = cv2.cvtColor(person_crop, cv2.COLOR_BGR2GRAY)
            with self._lock:
                detections = []
                for cascade in self._cascades:
                    detections.extend(cascade.detectMultiScale(
                        gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
                    ))
                # The bundled profile cascade is orientation-sensitive.
                flipped = cv2.flip(gray, 1)
                for cascade in self._cascades[1:]:
                    for x, y, box_width, box_height in cascade.detectMultiScale(
                        flipped, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
                    ):
                        detections.append((gray.shape[1] - x - box_width, y, box_width, box_height))
            height, width = person_crop.shape[:2]
            candidates = []
            for x, y, box_width, box_height in detections:
                center_x, center_y = x + box_width / 2, y + box_height / 2
                if center_y > height * 0.65:
                    continue
                center_bias = 1 - min(abs(center_x - width / 2) / max(width / 2, 1), 1)
                candidates.append((box_width * box_height * (0.9 + center_bias * 0.1), (float(x), float(y), float(x + box_width), float(y + box_height))))
            return max(candidates, key=lambda item: item[0])[1] if candidates else None
        with self._lock:
            results = self._model.predict(
                source=person_crop,
                conf=self._confidence,
                classes=sorted(self._head_class_ids),
                device=self._device,
                verbose=False,
            )
        if not results or results[0].boxes is None:
            return None
        height, width = person_crop.shape[:2]
        candidates: list[tuple[float, tuple[float, float, float, float]]] = []
        boxes = results[0].boxes
        for bounds, confidence in zip(
            boxes.xyxy.detach().cpu().tolist(), boxes.conf.detach().cpu().tolist(), strict=True
        ):
            x1, y1, x2, y2 = (float(value) for value in bounds)
            center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
            # The selected head must be contained in the tracked-person crop and in its upper region.
            if x1 < 0 or y1 < 0 or x2 > width or y2 > height or center_y > height * 0.65:
                continue
            center_bias = 1 - min(abs(center_x - width / 2) / max(width / 2, 1), 1)
            candidates.append((float(confidence) + center_bias * 0.10, (x1, y1, x2, y2)))
        return max(candidates, key=lambda item: item[0])[1] if candidates else None
