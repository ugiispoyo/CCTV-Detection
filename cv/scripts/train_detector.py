"""Explicit administrator-only YOLO detection training; never used by the realtime loop."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from ultralytics import YOLO

EXPECTED_NAMES = {0: "person", 1: "head", 2: "car", 3: "motorcycle"}


def validate_dataset(root: Path) -> Path:
    metadata_path, yaml_path = root / "metadata.json", root / "data.yaml"
    if not metadata_path.is_file() or not yaml_path.is_file():
        raise SystemExit("Dataset must contain metadata.json and data.yaml")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("classMapping") != {name: index for index, name in EXPECTED_NAMES.items()}:
        raise SystemExit("Dataset class mapping differs from the stable Phase 4.2 mapping")
    label_count = 0
    for label in root.glob("labels/*/*.txt"):
        label_count += 1
        for line_number, line in enumerate(label.read_text(encoding="utf-8").splitlines(), 1):
            parts = line.split()
            values = [float(value) for value in parts[1:]] if len(parts) == 5 else []
            if (len(parts) != 5 or int(parts[0]) not in EXPECTED_NAMES or any(not 0 <= value <= 1 for value in values)
                    or values[2] <= 0 or values[3] <= 0
                    or values[0] - values[2] / 2 < 0 or values[0] + values[2] / 2 > 1
                    or values[1] - values[3] / 2 < 0 or values[1] + values[3] / 2 > 1):
                raise SystemExit(f"Invalid YOLO annotation: {label}:{line_number}")
        image = root / "images" / label.parent.name / f"{label.stem}.jpg"
        if not image.is_file():
            raise SystemExit(f"Annotation has no matching image: {label}")
    if not label_count:
        raise SystemExit("Dataset contains no annotation files")
    train_hashes = {
        hashlib.sha256(path.read_bytes()).hexdigest(): path
        for path in (root / "images" / "train").glob("*.jpg")
    }
    for path in (root / "images" / "val").glob("*.jpg"):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in train_hashes:
            raise SystemExit(f"Exact train/validation image leakage: {train_hashes[digest]} and {path}")
    return yaml_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--base-model", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="mps")
    args = parser.parse_args()
    if os.environ.get("DATASET_TRAINING_ENABLED", "").lower() != "true":
        raise SystemExit("Set DATASET_TRAINING_ENABLED=true for an explicit administrator training run")
    if not args.base_model.is_file():
        raise SystemExit("The reviewed base model file does not exist")
    data = validate_dataset(args.dataset.resolve())
    project = Path(__file__).resolve().parents[1] / "data" / "training-runs"
    result = YOLO(str(args.base_model)).train(
        data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        patience=args.patience, workers=args.workers, seed=args.seed, deterministic=True,
        device=args.device, project=str(project), name=args.version, exist_ok=False,
    )
    summary = {"version": args.version, "dataset": str(args.dataset.resolve()), "baseModel": str(args.base_model.resolve()),
               "epochs": args.epochs, "imgsz": args.imgsz, "batch": args.batch, "patience": args.patience,
               "workers": args.workers, "seed": args.seed, "deterministic": True,
               "device": args.device, "output": str(result.save_dir)}
    (Path(result.save_dir) / "training-metadata.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
