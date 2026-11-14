"""Merge compatible YOLO datasets without changing their source directories."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")


def image_for_label(source: Path, split: str, stem: str) -> Path:
    matches = [source / "images" / split / f"{stem}{suffix}" for suffix in IMAGE_SUFFIXES]
    existing = [path for path in matches if path.is_file()]
    if len(existing) != 1:
        raise SystemExit(f"Expected one image for {source.name}/labels/{split}/{stem}.txt")
    return existing[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, action="append", required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    sources = [source.resolve() for source in args.source]
    if output.exists():
        raise SystemExit(f"Output already exists: {output}")
    if len(sources) < 2:
        raise SystemExit("At least two --source datasets are required")

    source_metadata = []
    for source in sources:
        metadata_path = source / "metadata.json"
        if not metadata_path.is_file():
            raise SystemExit(f"Missing metadata.json: {source}")
        source_metadata.append(json.loads(metadata_path.read_text(encoding="utf-8")))
    mapping = source_metadata[0].get("classMapping")
    if not isinstance(mapping, dict) or any(
        item.get("classMapping") != mapping for item in source_metadata[1:]
    ):
        raise SystemExit("All source datasets must have the same classMapping")

    output.mkdir(parents=True, mode=0o700)
    seen_hashes: dict[str, tuple[str, Path]] = {}
    split_counts: dict[str, dict[str, int]] = {}
    total_annotations = 0
    total_negatives = 0
    for split in ("train", "val"):
        image_output, label_output = output / "images" / split, output / "labels" / split
        image_output.mkdir(parents=True, mode=0o700)
        label_output.mkdir(parents=True, mode=0o700)
        images, annotations, negatives = 0, 0, 0
        for source_index, source in enumerate(sources):
            for label in sorted((source / "labels" / split).glob("*.txt")):
                image = image_for_label(source, split, label.stem)
                digest = hashlib.sha256(image.read_bytes()).hexdigest()
                if digest in seen_hashes:
                    previous_split, previous_image = seen_hashes[digest]
                    raise SystemExit(
                        "Duplicate image across datasets/splits: "
                        f"{previous_split}:{previous_image} and {split}:{image}"
                    )
                seen_hashes[digest] = (split, image)
                lines = label.read_text(encoding="utf-8").splitlines()
                prefix = f"s{source_index}-{source.name}-"
                shutil.copy2(image, image_output / f"{prefix}{image.name}")
                shutil.copy2(label, label_output / f"{prefix}{label.name}")
                images += 1
                annotations += len(lines)
                negatives += int(not lines)
        split_counts[split] = {
            "images": images, "annotations": annotations, "negatives": negatives,
        }
        total_annotations += annotations
        total_negatives += negatives

    (output / "data.yaml").write_text(
        f"path: {output}\ntrain: images/train\nval: images/val\nnames:\n"
        + "\n".join(f"  {class_id}: {name}" for name, class_id in mapping.items()) + "\n",
        encoding="utf-8",
    )
    result = {
        "versionId": output.name,
        "createdFor": "merged custom detector training",
        "sourceDatasets": [str(source) for source in sources],
        "classMapping": mapping,
        "imageCount": sum(item["images"] for item in split_counts.values()),
        "annotationCount": total_annotations,
        "negativeImageCount": total_negatives,
        "splitCounts": split_counts,
        "sourceMetadata": source_metadata,
    }
    (output / "metadata.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
