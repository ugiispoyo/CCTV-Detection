# CCTV AI Computer Vision Service

Independent, fully headless Python 3.12 worker for one or more RTSP streams, YOLO26 detection, per-camera ByteTrack tracking and line counting, durable SQLite buffering, and live annotated preview delivery to Fastify. It never accesses MongoDB or frontend state. JPEG previews are ephemeral WebSocket data and are never stored.

## Structure

```text
cv/
├── src/
│   ├── camera/       RTSP latest-frame capture and camera lifecycle
│   ├── detection/    YOLO loading, COCO validation, MPS selection
│   ├── tracking/     Per-camera ByteTrack session
│   ├── counting/     Signed-distance crossing and event generation
│   ├── clients/      Fastify HTTP contracts
│   ├── queue/        SQLite queue and asynchronous sender
│   ├── monitoring/   Heartbeat and performance metrics
│   ├── preview/      Overlay renderer, JPEG encoder, latest-frame publisher
│   └── utils/        Sanitized logging
├── models/           Local model cache
├── data/             SQLite runtime state
└── docs/             Setup and operating guides
```

## Requirements

- Apple Silicon Mac with macOS 15+ recommended
- Python 3.12
- A reachable RTSP camera
- The sibling Fastify platform with the camera created and active
- Network access on first run if `models/yolo26n.pt` is not already cached

Ultralytics YOLO code and model licensing must be reviewed before deployment. Ultralytics describes its open-source offering as AGPL-3.0 and offers an Enterprise license for proprietary/commercial use. This repository does not grant or interpret those rights; consult the current [Ultralytics licensing page](https://www.ultralytics.com/license).

## Install on Apple Silicon

```bash
cd cv
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Configure `.env`, especially `CV_SERVICE_TOKEN`, `RTSP_URL`, and `CAMERA_ID`. Do not commit `.env`.

Ultralytics declares GUI OpenCV by package name even though this service is headless. After a fresh requirements install, ensure only the headless distribution remains:

```bash
python -m pip uninstall -y opencv-python
python -m pip install --force-reinstall --no-deps 'opencv-python-headless>=4.12.0,<5.0'
```

## Run and stop

```bash
source .venv/bin/activate
python -m src.main
```

Send `Ctrl+C` or SIGTERM to stop. No local video window is created. Outstanding events remain in `data/events.sqlite3` and resume after restart.

The service validates Fastify camera configuration when the API is reachable, loads YOLO once, starts independent sender and heartbeat threads, connects to RTSP, and then processes latest frames at the configured target rate.

## Fastify integration

Create the same `CAMERA_ID` through `POST /api/cameras`, use the identical service token on both projects, and keep the camera active. The worker calls only:

- `GET /internal/cv/config`
- `POST /internal/cv/events`
- `POST /internal/cv/heartbeat`
- `WS /internal/cv/preview`

The platform currently returns `countingLine: null`, so Phase 2 line geometry remains local in `.env`. See [API integration](docs/api-integration.md).

## Operational notes

- Only COCO classes 0, 2, and 3 are passed into YOLO tracking.
- `DEVICE=auto` selects MPS only when `torch.backends.mps.is_available()` is true; otherwise CPU is used.
- RTSP credentials are held as a Pydantic secret and redacted from logs.
- SQLite queue capacity pauses inference instead of silently discarding events.
- Each stream connection creates a new per-camera tracking session, preventing state leakage between reconnects or lenses.
- See [multi-camera configuration](docs/multi-camera.md) for dual-lens setup and migration.
- No fixed FPS is guaranteed; resolution, camera behavior, model version, and hardware all matter.

See [setup](docs/setup.md), [configuration](docs/configuration.md), [counting logic](docs/counting-logic.md), and [troubleshooting](docs/troubleshooting.md).

Live preview reuses the processed frame and existing tracks/counter state. It publishes only the newest JPEG and cannot delay durable counting delivery. See [live preview](docs/live-preview.md).

## Person capture and manual labeling

When `PERSON_CAPTURE_ENABLED=true`, the worker reuses tracked person boxes—without duplicate person inference—to rank a time-bounded set of candidates. It finalizes only after the existing line counter emits a valid person crossing. Each crossing has an idempotent `crossingId`, so jitter cannot duplicate one event while a legitimate return by the same active track creates a separate directional capture. The Phase 5 default `PERSON_CAPTURE_DIRECTION=both` creates review crops for both IN and OUT. It writes an atomic full-body JPEG plus an optional detector-produced head JPEG under `data/snapshots/`. See [person capture](docs/person-capture.md), [head detector contract](docs/head-detector.md), and [dataset/training](docs/dataset-training.md).

Files are removed from the worker only after Fastify acknowledges delivery. Invalid uploads remain visible in the SQLite queue for diagnosis and are not silently discarded. Orphan cleanup never deletes files referenced by the queue. This is a review workflow only: there is no face recognition, biometric matching, or cross-session identity inference. See [person capture](docs/person-capture.md).
