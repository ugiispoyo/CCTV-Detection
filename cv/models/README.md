# Model cache

The configured Ultralytics weights are cached here. `*.pt` and `*.onnx` are ignored by Git. With the default `MODEL_PATH=yolo26n.pt`, the service resolves the file to `models/yolo26n.pt` and downloads it on first use when internet access is available.
