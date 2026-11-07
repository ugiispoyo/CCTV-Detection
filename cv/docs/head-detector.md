# Head detector contract

The preferred head crop path uses an explicitly supplied Ultralytics-compatible head object-detection model. A configured model must either expose a class named `head` or be a reviewed single-class model whose only documented class is `head`. The system never uses face embeddings or identity recognition.

When `HEAD_DETECTION_MODEL_PATH` is empty and `HEAD_DETECTION_ALLOW_OPENCV_FALLBACK=true`, the worker uses OpenCV's bundled frontal and profile Haar detectors. This is detection only—no recognition, embeddings, comparison, or identity persistence. Occlusion and steep camera angles may still produce `head unavailable`. The cascades ship with the installed OpenCV package; deployment must review the OpenCV package license.

## Reviewed local checkpoint

- Repository: [wesjos/YOLO-head-detection](https://huggingface.co/wesjos/YOLO-head-detection)
- File: `v8n-head.pt` (single class `0`, documented by the publisher as `head`)
- SHA-256: `72582443abdb4256e1472c8a6739ce8cab9054512fd19611c70e8786b6326d58`
- License declared by publisher: AGPL-3.0
- Intended use: head object detection on the already selected person crop only
- Local path: `cv/models/v8n-head.pt` (model binaries are intentionally gitignored)

Provision the reviewed file explicitly on each CV host:

```bash
curl -fL -o cv/models/v8n-head.pt \
  https://huggingface.co/wesjos/YOLO-head-detection/resolve/main/v8n-head.pt
shasum -a 256 cv/models/v8n-head.pt
```

The deployed `.env` uses confidence `0.25` for this checkpoint. Association remains constrained to the tracked person's crop and its upper region. Raise the threshold if camera-specific review shows false positives. The general `.env.example` retains the conservative `0.60` default for unknown models.

If the checkpoint is absent, leave `HEAD_DETECTION_MODEL_PATH` empty to use the OpenCV fallback. Do not point this setting at a face-recognition model.

The detector runs once on the selected full-body crop after a valid line crossing. It is not a second person detector and does not run continuously.
