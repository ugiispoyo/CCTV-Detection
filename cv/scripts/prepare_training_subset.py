"""Create a reproducible class subset from an exported YOLO dataset."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")


def find_image(root: Path, split: str, stem: str) -> Path:
    matches = [root / "images" / split / f"{stem}{suffix}" for suffix in IMAGE_SUFFIXES]
    existing = [path for path in matches if path.is_file()]
    if len(existing) != 1:
        raise SystemExit(
            f"Expected exactly one image for labels/{split}/{stem}.txt; found {existing}"
        )
    return existing[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--classes", nargs="+", required=True)
    parser.add_argument(
        "--keep-empty",
        action="store_true",
        help="Keep images whose remapped label is empty (background negatives).",
    )
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"Output already exists: {output}")
    metadata_path = source / "metadata.json"
    if not metadata_path.is_file():
        raise SystemExit("Source metadata.json is missing")
    source_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    source_mapping = source_metadata.get("classMapping")
    if not isinstance(source_mapping, dict):
        raise SystemExit("Source classMapping is invalid")
    missing = [name for name in args.classes if name not in source_mapping]
    if missing:
        raise SystemExit(f"Classes missing from source mapping: {missing}")

    output.mkdir(parents=True, mode=0o700)
    output.chmod(0o700)

    source_to_target = {
        int(source_mapping[name]): target_id
        for target_id, name in enumerate(args.classes)
    }
    image_count = 0
    annotation_count = 0
    negative_image_count = 0
    split_counts: dict[str, dict[str, int]] = {}
    for split in ("train", "val"):
        image_output = output / "images" / split
        label_output = output / "labels" / split
        image_output.mkdir(parents=True, mode=0o700)
        label_output.mkdir(parents=True, mode=0o700)
        image_output.chmod(0o700)
        label_output.chmod(0o700)
        split_images = 0
        split_annotations = 0
        for label_path in sorted((source / "labels" / split).glob("*.txt")):
            selected: list[str] = []
            for line in label_path.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) != 5:
                    raise SystemExit(f"Invalid annotation line in {label_path}")
                source_id = int(parts[0])
                if source_id in source_to_target:
                    selected.append(" ".join([str(source_to_target[source_id]), *parts[1:]]))
            if not selected and not args.keep_empty:
                continue
            image_path = find_image(source, split, label_path.stem)
            copied_image = image_output / image_path.name
            shutil.copy2(image_path, copied_image)
            copied_image.chmod(0o600)
            copied_label = label_output / label_path.name
            copied_label.write_text(
                ("\n".join(selected) + "\n") if selected else "", encoding="utf-8"
            )
            copied_label.chmod(0o600)
            split_images += 1
            split_annotations += len(selected)
            negative_image_count += int(not selected)
        split_counts[split] = {"images": split_images, "annotations": split_annotations}
        image_count += split_images
        annotation_count += split_annotations

    class_mapping = {name: index for index, name in enumerate(args.classes)}
    data_yaml = output / "data.yaml"
    data_yaml.write_text(
        f"path: {output}\ntrain: images/train\nval: images/val\nnames:\n"
        + "\n".join(f"  {index}: {name}" for name, index in class_mapping.items())
        + "\n",
        encoding="utf-8",
    )
    data_yaml.chmod(0o600)
    metadata = {
        "versionId": output.name,
        "sourceDataset": str(source),
        "sourceVersionId": source_metadata.get("versionId"),
        "createdFor": "explicit administrator candidate training",
        "imageCount": image_count,
        "annotationCount": annotation_count,
        "negativeImageCount": negative_image_count,
        "keptEmptyLabels": args.keep_empty,
        "classMapping": class_mapping,
        "splitCounts": split_counts,
        "excludedClasses": sorted(set(source_mapping) - set(args.classes)),
        "sourceMetadata": source_metadata,
    }
    metadata_output = output / "metadata.json"
    metadata_output.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    metadata_output.chmod(0o600)
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
