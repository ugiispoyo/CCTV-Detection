from __future__ import annotations

import argparse
import json
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--device", default="mps")
    args = parser.parse_args()
    if not args.model.is_file() or not args.data.is_file():
        raise SystemExit("Model and data.yaml must exist")
    metrics = YOLO(str(args.model)).val(data=str(args.data), device=args.device)
    class_indices = [int(value) for value in metrics.box.ap_class_index.tolist()]
    names = metrics.names
    per_class = {}
    for metric_index, class_id in enumerate(class_indices):
        class_name = str(names[class_id] if isinstance(names, dict) else names[class_id])
        per_class[class_name] = {
            "precision": float(metrics.box.p[metric_index]),
            "recall": float(metrics.box.r[metric_index]),
            "map50": float(metrics.box.ap50[metric_index]),
            "map50_95": float(metrics.box.ap[metric_index]),
        }
    result = {"precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
              "map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
              "perClass": per_class, "device": args.device,
              "model": str(args.model.resolve()), "data": str(args.data.resolve())}
    output = args.model.with_suffix(".evaluation.json")
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({**result, "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
