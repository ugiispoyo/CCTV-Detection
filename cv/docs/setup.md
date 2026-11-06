# macOS Apple Silicon setup

## 1. Install Python 3.12

Confirm the interpreter is native arm64:

```bash
python3.12 --version
python3.12 -c 'import platform; print(platform.machine())'
```

The output should report Python 3.12 and `arm64`. Install Python with Homebrew, pyenv, or uv if it is unavailable; do not use the system Python for this service.

## 2. Create an isolated environment

```bash
cd cv
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m pip uninstall -y opencv-python
python -m pip install --force-reinstall --no-deps 'opencv-python-headless>=4.12.0,<5.0'
```

PyTorch macOS wheels include MPS support. The application checks runtime availability rather than assuming it from the machine architecture. The official [PyTorch MPS documentation](https://docs.pytorch.org/docs/stable/notes/mps.html) explains the availability check and OS/device requirements.

## 3. Configure

```bash
cp .env.example .env
chmod 600 .env
```

Add the same service token configured in Fastify and the RTSP URLs for enabled YAML cameras. Keep `.env` local. The existing `CAMERA_ID`/`RTSP_URL` pair remains a migration fallback for `cam-001`.

Create the camera before running:

```bash
curl -X POST http://127.0.0.1:5005/api/cameras \
  -H 'content-type: application/json' \
  -d '{"cameraId":"cam-001","name":"Front entrance","location":"Lobby"}'
```

## 4. First start

```bash
python -m src.main
```

If the model is absent, Ultralytics downloads `yolo26n.pt` into `models/`. For offline startup, place the already obtained compatible weight file at that path first. Tracking uses the built-in `bytetrack.yaml` and `persist=True` for consecutive frames, matching the official [Ultralytics tracking API](https://docs.ultralytics.com/modes/track/).

## 5. Headless operation

`CV_HEADLESS=true` and `LOCAL_PREVIEW_ENABLED=false` are enforced. No GUI or HTTP video server is started. Dashboard JPEG publication remains controlled separately by `LIVE_PREVIEW_ENABLED`. Use SIGTERM for managed shutdown and preserve `data/` across restarts.
