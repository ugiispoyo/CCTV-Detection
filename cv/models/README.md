# Model cache

The configured Ultralytics weights are cached here. `*.pt` and `*.onnx` are ignored by Git. With the default `MODEL_PATH=yolo26n.pt`, the service resolves the file to `models/yolo26n.pt` and downloads it on first use when internet access is available.

Head detection is different: `HEAD_DETECTION_MODEL_PATH` must point to a separately reviewed object detector whose class mapping contains `head`. It is never downloaded automatically. Record origin, version/checksum, dataset, license, and approval in `../docs/head-detector.md` before enabling it.
