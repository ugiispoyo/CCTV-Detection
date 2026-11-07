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
