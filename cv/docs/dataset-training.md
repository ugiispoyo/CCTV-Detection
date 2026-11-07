# Detection dataset and training

Stable class mapping: `0 person`, `1 head`, `2 car`, `3 motorcycle`. Resident identity fields are stored separately and never exported.

Approved annotations are exported by the protected Fastify `POST /api/dataset/exports` endpoint. Identical annotations are rejected, and every create, bounding-box correction, approval, or rejection is recorded in `dataset_annotation_history`. When at least two tracking sessions exist, the deterministic split groups by camera and session so one visit cannot leak across train and validation. A single-session dataset falls back to capture grouping and records that limitation in `metadata.json`.

Before training, the validator checks the stable class mapping, normalized box boundaries, image/label pairs, and exact image leakage between train and validation. It does not treat resident names as detection classes.

Training is administrator initiated and disabled by default:

```bash
cd cv
DATASET_TRAINING_ENABLED=true .venv/bin/python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v1 \
  --base-model models/current-reviewed.pt --version detector-v2 \
  --epochs 100 --batch 8 --patience 20 --seed 42 --device mps

.venv/bin/python scripts/evaluate_detector.py \
  --model data/training-runs/detector-v2/weights/best.pt \
  --data data/datasets/vehicle-person-detector/v1/data.yaml --device mps
```

`training-metadata.json` records the dataset, base model, seed, image size, batch, patience, device, and output path. Evaluation writes overall precision, recall, mAP50, mAP50-95, and per-class person/head/car/motorcycle metrics next to the candidate weight.

Register metrics through `POST /api/models/versions`. A worse candidate can be explicitly rejected through `/api/models/versions/:modelVersionId/reject`; a better candidate still requires approval and activation. Activation updates only the registry and never overwrites `MODEL_PATH`. Deployment requires an explicit configuration change and CV restart. Rollback activates a previously approved/retired registry version and restores its versioned model path. Never point production at an unapproved training-run file.

## Training selected classes while preserving the legacy car detector

Create a derived dataset when a candidate should train only `person`, `head`, and
`motorcycle`. The command remaps those classes to contiguous IDs `0, 1, 2` and
does not mutate the approved export:

```bash
cd cv
.venv/bin/python scripts/prepare_training_subset.py \
  data/datasets/vehicle-person-detector/v128 \
  data/datasets/vehicle-person-detector/v128-person-head-motorcycle \
  --classes person head motorcycle

DATASET_TRAINING_ENABLED=true .venv/bin/python scripts/train_detector.py \
  data/datasets/vehicle-person-detector/v128-person-head-motorcycle \
  --base-model models/yolo26n.pt \
  --version detector-v128-phm-candidate \
  --class-names person head motorcycle \
  --epochs 60 --imgsz 640 --batch 8 --patience 12 --workers 0 \
  --seed 42 --device mps
```

The optional hybrid runtime keeps `MODEL_PATH` as the legacy car-only source and
uses the custom candidate for `person`, `head`, and `motorcycle`. It is an
acceptance-test switch, not automatic deployment:

```dotenv
MODEL_PATH=yolo26n.pt
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
CUSTOM_DETECTOR_MODEL_PATH=data/training-runs/detector-v128-phm-candidate/weights/best.pt
```

When enabled, head boxes are rendered in the Python JPEG preview but are excluded
from counting events and the existing dashboard object metadata contract. The
legacy model supplies only class `car`; this avoids duplicate car boxes from the
custom detector. Hybrid mode performs two inference passes and therefore must be
checked for per-camera FPS before approval.

## v128 person/head/motorcycle trial (2026-11-07)

The completed smoke candidate is stored at
`data/training-runs/detector-v128-phm-smoke/weights/best.pt`. Its independent
34-image validation reported precision `0.8546`, recall `0.9144`, mAP50 `0.8868`,
and mAP50-95 `0.6716`. These are internal crop-dataset metrics only.

Live acceptance on both H9c lenses failed: the candidate produced large person
false positives on background structures, did not render a reliable head box,
and missed a visible parked motorcycle. The v128 export is dominated by cropped
review images, so it does not represent full CCTV frames well enough. That v128
candidate was disabled after its trial. Before retraining,
add approved full-frame samples from both lenses with person/head/motorcycle boxes,
including empty/background negatives, small/distant people, children, occlusion,
day/night scenes, and motorcycles with and without a nearby person. Split by
capture session, not adjacent frames, then repeat the live acceptance check.

## v256 person/head/motorcycle live candidate (2026-11-07)

The newer candidate uses 271 approved images and 615 boxes from 32 tracking
sessions. Its derived dataset contains 179 train images and 92 validation images,
with contiguous classes `0 person`, `1 head`, `2 motorcycle`. Training ran for
40 epochs at 640 pixels on Apple MPS. The candidate and independent evaluation
are stored under:

```text
data/training-runs/detector-v256-phm-live-v1/weights/best.pt
data/training-runs/detector-v256-phm-live-v1/weights/best.evaluation.json
```

Independent validation reported precision `0.8913`, recall `0.8756`, mAP50
`0.8956`, and mAP50-95 `0.6267`. Per-class mAP50 was person `0.8857`, head
`0.9043`, and motorcycle `0.8968`.

At the operator's request, this candidate is currently enabled in experimental
hybrid mode while `yolo26n.pt` remains the sole car detector. Live frames showed
correct legacy car boxes and a correct motorcycle box, but also large false
positive person/motorcycle boxes on background regions; a reliable live head box
was not observed in the sampled frames. Keep monitoring both lenses and do not
interpret validation metrics as live acceptance.

Rollback does not remove the candidate. Set the following and restart CV:

```dotenv
EXPERIMENTAL_HYBRID_DETECTOR_ENABLED=false
```
