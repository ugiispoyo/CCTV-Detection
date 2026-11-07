from __future__ import annotations

import contextlib
import logging
import os
from pathlib import Path
from typing import Iterator

import torch

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("YOLO_CONFIG_DIR", str(_PROJECT_ROOT / "data" / "ultralytics"))

from ultralytics import YOLO

OBJECT_CLASSES = {0: "person", 2: "car", 3: "motorcycle"}
LOGGER = logging.getLogger(__name__)


@contextlib.contextmanager
def _working_directory(path: Path) -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


def select_device(requested: str) -> str:
    mps_available = bool(torch.backends.mps.is_available())
    if requested == "mps" and not mps_available:
        raise RuntimeError("DEVICE=mps was requested, but PyTorch MPS is unavailable")
    if requested == "auto":
        return "mps" if mps_available else "cpu"
    return requested


class Detector:
    def __init__(self, model_path: Path, requested_device: str,
                 object_classes: dict[int, str] | None = None) -> None:
        self.device = select_device(requested_device)
        self.object_classes = object_classes or OBJECT_CLASSES
        model_path.parent.mkdir(parents=True, exist_ok=True)
        if model_path.exists():
            LOGGER.info("Loading cached YOLO model path=%s", model_path)
            self.model = YOLO(str(model_path))
        else:
            LOGGER.info("YOLO model not cached; downloading model=%s cache=%s", model_path.name, model_path.parent)
            with _working_directory(model_path.parent):
                self.model = YOLO(model_path.name)
        self._validate_classes()
        LOGGER.info("YOLO model loaded model=%s device=%s", model_path.name, self.device)

    def _validate_classes(self) -> None:
        names = self.model.names
        for class_id, expected in self.object_classes.items():
            actual = names.get(class_id) if isinstance(names, dict) else names[class_id]
            if str(actual).lower() != expected:
                raise RuntimeError(
                    f"Model class {class_id} is {actual!r}; expected configured class {expected!r}"
                )
