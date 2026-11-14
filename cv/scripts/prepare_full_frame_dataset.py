"""Build a leakage-resistant YOLO dataset from a reviewed full-frame manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path


CLASS_MAPPING = {"person": 0, "head": 1, "car": 2, "motorcycle": 3}
VALID_LENSES = {"lens-1", "lens-2"}
VALID_LIGHTING = {"day", "night"}
VALID_SCENES = {"empty", "person", "motorcycle", "mixed"}
VALID_USAGE = {"train", "regression"}


def stable_train_split(group: str) -> str:
    value = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 10
    return "val" if value < 2 else "train"


def validate_label(path: Path) -> int:
    if not path.is_file():
        raise SystemExit(f"Label file is missing (use an empty file for negatives): {path}")
    count = 0
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        parts = line.split()
        try:
            class_id = int(parts[0])
            box = [float(value) for value in parts[1:]]
        except (IndexError, ValueError) as exc:
            raise SystemExit(f"Invalid label {path}:{line_number}") from exc
        if len(parts) != 5 or class_id not in CLASS_MAPPING.values() or len(box) != 4:
            raise SystemExit(f"Invalid label {path}:{line_number}")
        x, y, width, height = box
        if (width <= 0 or height <= 0 or x - width / 2 < 0 or x + width / 2 > 1
                or y - height / 2 < 0 or y + height / 2 > 1):
            raise SystemExit(f"Bounding box is outside the image: {path}:{line_number}")
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--enforce-regression-baseline",
        action="store_true",
        help="Require 40 regression frames, 10 per core scene, both lenses, day and night.",
    )
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"Output already exists: {output}")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("classMapping") != CLASS_MAPPING:
        raise SystemExit(f"classMapping must be {CLASS_MAPPING}")
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise SystemExit("Manifest items must be a non-empty list")
    regression_image_count = sum(
        1 for item in items
        if isinstance(item, dict) and item.get("usage") == "regression"
    )

    if args.enforce_regression_baseline:
        regression_items = [
            item for item in items if isinstance(item, dict) and item.get("usage") == "regression"
        ]
        scene_counts = Counter(str(item.get("scene")) for item in regression_items)
        lenses = {item.get("lens") for item in regression_items}
        lighting = {item.get("lighting") for item in regression_items}
        missing_dimensions = sorted((VALID_LENSES - lenses) | (VALID_LIGHTING - lighting))
        if (len(regression_items) < 40
                or any(scene_counts[scene] < 10 for scene in ("empty", "person", "motorcycle"))
                or missing_dimensions):
            raise SystemExit(
                "Regression baseline is incomplete: "
                f"total={len(regression_items)}, scenes={dict(scene_counts)}, "
                f"missing={missing_dimensions}"
            )

    base = manifest_path.parent
    seen_images: set[str] = set()
    seen_groups: dict[str, str] = {}
    coverage: Counter[str] = Counter()
    split_counts: Counter[str] = Counter()
    annotation_count = 0
    output.mkdir(parents=True, mode=0o700)
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise SystemExit(f"items[{index}] must be an object")
        lens, lighting = item.get("lens"), item.get("lighting")
        scene, usage, group = item.get("scene"), item.get("usage"), item.get("group")
        if lens not in VALID_LENSES or lighting not in VALID_LIGHTING:
            raise SystemExit(f"Invalid lens/lighting at items[{index}]")
        if (scene not in VALID_SCENES or usage not in VALID_USAGE
                or not isinstance(group, str) or not group):
            raise SystemExit(f"Invalid scene/usage/group at items[{index}]")
        image = (base / str(item.get("image", ""))).resolve()
        label = (base / str(item.get("label", ""))).resolve()
        if not image.is_file() or image.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            raise SystemExit(f"Invalid image at items[{index}]: {image}")
        image_hash = hashlib.sha256(image.read_bytes()).hexdigest()
        if image_hash in seen_images:
            raise SystemExit(f"Duplicate image content: {image}")
        seen_images.add(image_hash)
        labels = validate_label(label)
        if scene == "empty" and labels:
            raise SystemExit(f"Empty scene must have an empty label: {label}")

        split = "regression" if usage == "regression" else stable_train_split(group)
        previous_split = seen_groups.setdefault(group, split)
        if previous_split != split:
            raise SystemExit(f"Group {group!r} crosses usage/splits")
        destination_stem = f"{index:04d}-{image.stem}"
        image_dir, label_dir = output / "images" / split, output / "labels" / split
        image_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        label_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(image, image_dir / f"{destination_stem}{image.suffix.lower()}")
        shutil.copy2(label, label_dir / f"{destination_stem}.txt")
        coverage[f"{usage}:{lens}:{lighting}:{scene}"] += 1
        split_counts[split] += 1
        annotation_count += labels

    data_yaml = output / "data.yaml"
    data_yaml.write_text(
        f"path: {output}\ntrain: images/train\nval: images/val\nnames:\n"
        + "\n".join(f"  {class_id}: {name}" for name, class_id in CLASS_MAPPING.items()) + "\n",
        encoding="utf-8",
    )
    metadata = {
        "versionId": output.name,
        "sourceManifest": str(manifest_path),
        "classMapping": CLASS_MAPPING,
        "imageCount": len(items),
        "annotationCount": annotation_count,
        "splitCounts": dict(sorted(split_counts.items())),
        "coverage": dict(sorted(coverage.items())),
        "regressionFrozen": regression_image_count > 0,
        "regressionImageCount": regression_image_count,
        "regressionBaselineEnforced": args.enforce_regression_baseline,
    }
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
