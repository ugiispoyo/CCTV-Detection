"""Collect reviewable full-frame CCTV assets without assigning them to training/test."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import cv2
import numpy as np
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.camera.configuration import load_camera_configs
from src.camera.rtsp import RTSPCapture
from src.config import Settings


LOGGER = logging.getLogger("full-frame-collector")
CUSTOM_CLASSES = {0: "person", 1: "head", 2: "motorcycle"}
LEGACY_CLASSES = {0: "person", 2: "car", 3: "motorcycle"}


def fingerprint(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA)


def sufficiently_different(candidate: np.ndarray, previous: list[np.ndarray], threshold: float) -> bool:
    return all(float(np.mean(cv2.absdiff(candidate, item))) >= threshold for item in previous)


def detections(result: object, mapping: dict[int, str]) -> list[dict[str, object]]:
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []
    output = []
    for class_id, confidence, box in zip(
        boxes.cls.tolist(), boxes.conf.tolist(), boxes.xyxy.tolist(), strict=True,
    ):
        name = mapping.get(int(class_id))
        if name is not None:
            output.append({
                "className": name,
                "confidence": round(float(confidence), 6),
                "xyxy": [round(float(value), 2) for value in box],
            })
    return output


def category_for(custom: list[dict[str, object]], legacy: list[dict[str, object]]) -> str:
    legacy_names = {str(item["className"]) for item in legacy}
    custom_names = {str(item["className"]) for item in custom}
    if "person" in legacy_names and "motorcycle" in legacy_names:
        return "mixed"
    if "motorcycle" in legacy_names:
        return "motorcycle"
    if "person" in legacy_names:
        return "person"
    if custom_names & {"person", "motorcycle"}:
        return "ambiguous"
    return "empty"


def write_manifest(path: Path, items: list[dict[str, object]], target: int) -> None:
    counts: dict[str, int] = defaultdict(int)
    for item in items:
        counts[f'{item["lens"]}:{item["categoryCandidate"]}'] += 1
    payload = {
        "version": 1,
        "createdAt": datetime.now(ZoneInfo("Asia/Jakarta")).isoformat(),
        "lighting": "day",
        "usage": "unassigned",
        "reviewRequired": True,
        "targetPerLensPerCategory": target,
        "counts": dict(sorted(counts.items())),
        "items": items,
        "notes": (
            "Categories are model-assisted candidates, not ground truth. "
            "Review before annotation or assigning training/regression usage."
        ),
    }
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target-per-lens", type=int, default=10)
    parser.add_argument("--interval-seconds", type=float, default=8)
    parser.add_argument("--timeout-minutes", type=float, default=15)
    parser.add_argument("--difference-threshold", type=float, default=1.5)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--custom-model", type=Path, required=True)
    parser.add_argument("--legacy-model", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    if args.output.exists() and not args.resume:
        raise SystemExit(f"Output already exists: {args.output.resolve()}")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=args.resume, mode=0o700)
    manifest_path = output / "manifest.json"
    settings = Settings()
    cameras = load_camera_configs(settings)
    if len(cameras) < 2:
        raise SystemExit("At least two enabled camera lenses are required")

    custom_model = YOLO(str(args.custom_model.resolve()))
    legacy_model = YOLO(str(args.legacy_model.resolve()))
    stop_event = threading.Event()
    captures = {
        camera.camera_id: RTSPCapture(
            camera.rtsp_url.get_secret_value(), settings.RTSP_TRANSPORT,
            settings.RTSP_CONNECT_TIMEOUT_MS, settings.RTSP_READ_TIMEOUT_MS,
            settings.RTSP_RECONNECT_INITIAL_SECONDS, settings.RTSP_RECONNECT_MAX_SECONDS,
            stop_event,
        )
        for camera in cameras
    }
    for capture in captures.values():
        capture.start()

    items: list[dict[str, object]] = []
    fingerprints: dict[tuple[str, str], list[np.ndarray]] = defaultdict(list)
    counts: dict[tuple[str, str], int] = defaultdict(int)
    if args.resume and manifest_path.is_file():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        items = list(previous.get("items", []))
        for item in items:
            lens = str(item["lens"])
            category = str(item["categoryCandidate"])
            counts[(lens, category)] += 1
            image = cv2.imread(str(output / str(item["image"])))
            if image is not None:
                fingerprints[(lens, category)].append(fingerprint(image))
    sequences: dict[str, int] = defaultdict(int)
    last_attempt: dict[str, float] = defaultdict(float)
    started = time.monotonic()
    deadline = started + args.timeout_minutes * 60
    core_categories = ("empty", "person", "motorcycle")

    def complete() -> bool:
        return all(
            counts[(lens, category)] >= args.target_per_lens
            for lens in ("lens-1", "lens-2")
            for category in core_categories
        )

    required = len(cameras) * len(core_categories) * args.target_per_lens
    try:
        while time.monotonic() < deadline and not complete():
            made_attempt = False
            for camera in cameras:
                now = time.monotonic()
                if now - last_attempt[camera.camera_id] < args.interval_seconds:
                    continue
                latest = captures[camera.camera_id].latest(sequences[camera.camera_id])
                if latest is None:
                    continue
                sequences[camera.camera_id] = latest.sequence
                last_attempt[camera.camera_id] = now
                made_attempt = True
                frame = latest.image.copy()
                custom_result = custom_model.predict(
                    frame, conf=args.confidence, imgsz=camera.image_size,
                    device=args.device, verbose=False,
                )[0]
                legacy_result = legacy_model.predict(
                    frame, conf=args.confidence, imgsz=camera.image_size,
                    device=args.device, verbose=False,
                )[0]
                custom = detections(custom_result, CUSTOM_CLASSES)
                legacy = detections(legacy_result, LEGACY_CLASSES)
                category = category_for(custom, legacy)
                lens = "lens-1" if camera.lens_name == "Lens 1" else "lens-2"
                key = (lens, category)
                if counts[key] >= args.target_per_lens:
                    continue
                signature = fingerprint(frame)
                if not sufficiently_different(
                    signature, fingerprints[key], args.difference_threshold,
                ):
                    continue
                captured_at = datetime.now(ZoneInfo("Asia/Jakarta"))
                directory = output / "images" / lens / "day" / category
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                filename = f"{lens}-day-{category}-{counts[key] + 1:03d}-{captured_at:%Y%m%dT%H%M%S}.jpg"
                destination = directory / filename
                if not cv2.imwrite(str(destination), frame, [cv2.IMWRITE_JPEG_QUALITY, 95]):
                    raise RuntimeError(f"Failed to write {destination}")
                digest = hashlib.sha256(destination.read_bytes()).hexdigest()
                relative = destination.relative_to(output).as_posix()
                item = {
                    "image": relative,
                    "cameraId": camera.camera_id,
                    "lens": lens,
                    "lighting": "day",
                    "categoryCandidate": category,
                    "capturedAt": captured_at.isoformat(),
                    "width": int(frame.shape[1]),
                    "height": int(frame.shape[0]),
                    "sha256": digest,
                    "usage": "unassigned",
                    "reviewStatus": "pending",
                    "customDetections": custom,
                    "legacyDetections": legacy,
                }
                items.append(item)
                fingerprints[key].append(signature)
                counts[key] += 1
                write_manifest(manifest_path, items, args.target_per_lens)
                LOGGER.info("Saved lens=%s category=%s count=%d", lens, category, counts[key])
            if not made_attempt:
                time.sleep(0.2)
    finally:
        stop_event.set()
        for capture in captures.values():
            capture.join(timeout=10)
        write_manifest(manifest_path, items, args.target_per_lens)

    summary = {
        "output": str(output),
        "captured": len(items),
        "target": required,
        "counts": {f"{lens}:{category}": count for (lens, category), count in sorted(counts.items())},
        "elapsedSeconds": round(time.monotonic() - started, 1),
        "complete": complete(),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
