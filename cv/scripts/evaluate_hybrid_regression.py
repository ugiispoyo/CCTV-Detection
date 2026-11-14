"""Compare a legacy YOLO detector with the runtime hybrid on frozen full frames."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from ultralytics import YOLO


CANONICAL = {0: "person", 1: "head", 2: "car", 3: "motorcycle"}
LEGACY_CLASSES = {0: "person", 2: "car", 3: "motorcycle"}
CUSTOM_CLASSES = {0: "person", 1: "head", 2: "motorcycle"}


def iou(first: list[float], second: list[float]) -> float:
    left, top = max(first[0], second[0]), max(first[1], second[1])
    right, bottom = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def read_truth(label: Path, width: int, height: int) -> dict[str, list[list[float]]]:
    truth: dict[str, list[list[float]]] = defaultdict(list)
    for line in label.read_text(encoding="utf-8").splitlines():
        class_id, x, y, box_width, box_height = line.split()
        name = CANONICAL[int(class_id)]
        x, y, box_width, box_height = map(float, (x, y, box_width, box_height))
        truth[name].append([
            (x - box_width / 2) * width,
            (y - box_height / 2) * height,
            (x + box_width / 2) * width,
            (y + box_height / 2) * height,
        ])
    return truth


def predictions(result: Any, mapping: dict[int, str]) -> dict[str, list[list[float]]]:
    output: dict[str, list[list[float]]] = defaultdict(list)
    if result.boxes is None:
        return output
    for class_id, box in zip(result.boxes.cls.tolist(), result.boxes.xyxy.tolist(), strict=True):
        name = mapping.get(int(class_id))
        if name is not None:
            output[name].append([float(value) for value in box])
    return output


def add_matches(stats: dict[str, dict[str, int]], truth: dict[str, list[list[float]]],
                predicted: dict[str, list[list[float]]], threshold: float) -> None:
    for class_name in CANONICAL.values():
        expected, found = truth.get(class_name, []), predicted.get(class_name, [])
        pairs = sorted(
            ((iou(expected_box, found_box), truth_index, prediction_index)
             for truth_index, expected_box in enumerate(expected)
             for prediction_index, found_box in enumerate(found)),
            reverse=True,
        )
        used_truth: set[int] = set()
        used_predictions: set[int] = set()
        for overlap, truth_index, prediction_index in pairs:
            if overlap < threshold:
                break
            if truth_index not in used_truth and prediction_index not in used_predictions:
                used_truth.add(truth_index)
                used_predictions.add(prediction_index)
        stats[class_name]["tp"] += len(used_truth)
        stats[class_name]["fn"] += len(expected) - len(used_truth)
        stats[class_name]["fp"] += len(found) - len(used_predictions)


def summarize(stats: dict[str, dict[str, int]]) -> dict[str, dict[str, float | int | None]]:
    result: dict[str, dict[str, float | int | None]] = {}
    for name, counts in stats.items():
        tp, fp, fn = counts["tp"], counts["fp"], counts["fn"]
        result[name] = {
            **counts,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
        }
    return result


def validate_names(model: YOLO, expected: dict[int, str], label: str) -> None:
    names = model.names
    for class_id, class_name in expected.items():
        actual = names.get(class_id) if isinstance(names, dict) else names[class_id]
        if str(actual).lower() != class_name:
            raise SystemExit(f"{label} class {class_id} is {actual!r}; expected {class_name!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "dataset", type=Path,
        help="Full-frame dataset produced by prepare_full_frame_dataset.py",
    )
    parser.add_argument("--legacy-model", type=Path, required=True)
    parser.add_argument("--custom-model", type=Path, required=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.50, dest="nms_iou")
    parser.add_argument("--match-iou", type=float, default=0.50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    dataset = args.dataset.resolve()
    image_dir, label_dir = dataset / "images" / "regression", dataset / "labels" / "regression"
    images = sorted(
        path for path in image_dir.iterdir()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not images:
        raise SystemExit(f"No regression images found in {image_dir}")
    for image in images:
        if not (label_dir / f"{image.stem}.txt").is_file():
            raise SystemExit(f"Missing regression label for {image}")

    legacy, custom = YOLO(str(args.legacy_model.resolve())), YOLO(str(args.custom_model.resolve()))
    validate_names(legacy, LEGACY_CLASSES, "Legacy model")
    validate_names(custom, CUSTOM_CLASSES, "Custom model")
    options = dict(
        conf=args.confidence, iou=args.nms_iou, imgsz=args.imgsz,
        device=args.device, verbose=False,
    )
    legacy_results = legacy.predict(source=[str(path) for path in images], stream=True, **options)
    custom_results = custom.predict(source=[str(path) for path in images], stream=True, **options)
    baseline_stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    hybrid_stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    empty = {"frames": 0, "baselineFramesWithFalsePositive": 0, "hybridFramesWithFalsePositive": 0,
             "baselineFalsePositives": 0, "hybridFalsePositives": 0}

    for image, legacy_result, custom_result in zip(
        images, legacy_results, custom_results, strict=True,
    ):
        truth = read_truth(
            label_dir / f"{image.stem}.txt",
            legacy_result.orig_shape[1], legacy_result.orig_shape[0],
        )
        legacy_prediction = predictions(legacy_result, LEGACY_CLASSES)
        custom_prediction = predictions(custom_result, CUSTOM_CLASSES)
        hybrid_prediction = {name: list(boxes) for name, boxes in custom_prediction.items()}
        hybrid_prediction["car"] = legacy_prediction.get("car", [])
        add_matches(baseline_stats, truth, legacy_prediction, args.match_iou)
        add_matches(hybrid_stats, truth, hybrid_prediction, args.match_iou)
        if not any(truth.values()):
            empty["frames"] += 1
            baseline_fp = sum(len(boxes) for boxes in legacy_prediction.values())
            hybrid_fp = sum(len(boxes) for boxes in hybrid_prediction.values())
            empty["baselineFalsePositives"] += baseline_fp
            empty["hybridFalsePositives"] += hybrid_fp
            empty["baselineFramesWithFalsePositive"] += int(baseline_fp > 0)
            empty["hybridFramesWithFalsePositive"] += int(hybrid_fp > 0)

    report = {
        "dataset": str(dataset), "legacyModel": str(args.legacy_model.resolve()),
        "customModel": str(args.custom_model.resolve()), "imageCount": len(images),
        "confidence": args.confidence, "nmsIou": args.nms_iou, "matchIou": args.match_iou,
        "baseline": summarize(baseline_stats), "hybrid": summarize(hybrid_stats),
        "emptyFrames": empty,
        "note": (
            "Baseline head metrics are not comparable because the legacy model has no head class."
        ),
    }
    output = args.output or args.custom_model.with_suffix(".full-frame-regression.json")
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**report, "output": str(output.resolve())}, indent=2))


if __name__ == "__main__":
    main()
