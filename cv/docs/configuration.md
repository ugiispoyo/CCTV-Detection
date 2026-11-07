# Configuration

Configuration is loaded from `cv/.env` based on the source location, not the shell working directory. Invalid ranges, secrets, identifiers, devices, and zero-length lines fail startup.

| Variable | Purpose |
|---|---|
| `API_BASE_URL` | Fastify origin, normally `http://127.0.0.1:5005` |
| `CV_SERVICE_TOKEN` | Required 32+ character service secret; never logged |
| `WORKER_ID` | Stable worker identifier sent in heartbeats |
| `CAMERA_ID` | Active Fastify camera identifier |
| `CAMERA_CONFIG` | YAML path, default `config/cameras.yaml` |
| `RTSP_URL` | Legacy single-camera URL and safe migration fallback |
| `H9C_LENS_1_RTSP_URL` | Secret Lens 1 URL; empty while unverified/disabled |
| `H9C_LENS_2_RTSP_URL` | Secret Lens 2 URL; may replace legacy `RTSP_URL` |
| `RTSP_TRANSPORT` | `tcp` or `udp`; TCP is the reliable default |
| `RTSP_CONNECT_TIMEOUT_MS` | Open timeout passed to OpenCV/FFmpeg |
| `RTSP_READ_TIMEOUT_MS` | Maximum expected blocking read duration |
| `RTSP_RECONNECT_INITIAL_SECONDS` | First reconnect delay |
| `RTSP_RECONNECT_MAX_SECONDS` | Exponential-backoff ceiling |
| `MODEL_PATH` | Weight filename or path; a bare name caches under `models/` |
| `DEVICE` | `auto`, `mps`, or `cpu` |
| `CONFIDENCE_THRESHOLD` | Minimum YOLO detection confidence |
| `IOU_THRESHOLD` | YOLO non-maximum-suppression IoU threshold |
| `IMAGE_SIZE` | Inference size, 160–2048 and divisible by 32 |
| `TARGET_PROCESSING_FPS` | Maximum inference scheduling rate; newer frames replace older ones |
| `CV_HEADLESS` | Must remain `true` |
| `LOCAL_PREVIEW_ENABLED` | Must remain `false`; dashboard preview is independent |
| `LIVE_PREVIEW_ENABLED` | Encode and publish annotated JPEG preview frames |
| `LIVE_PREVIEW_FPS` | Preview cap, 2–10 FPS; independent from inference FPS |
| `LIVE_PREVIEW_WIDTH` | Maximum JPEG width; aspect ratio is preserved |
| `LIVE_PREVIEW_JPEG_QUALITY` | OpenCV JPEG quality, 30–95 |
| `LIVE_PREVIEW_MAX_FRAME_BYTES` | Drop encoded previews exceeding this size |
| `CV_PREVIEW_WS_URL` | Internal Fastify publisher WebSocket URL |
| `CV_PREVIEW_RECONNECT_INITIAL_SECONDS` | First publisher reconnect delay |
| `CV_PREVIEW_RECONNECT_MAX_SECONDS` | Publisher reconnect backoff ceiling |
| `COUNTING_LINE_X1/Y1/X2/Y2` | Line endpoints normalized to `[0,1]` |
| `COUNTING_MARGIN` | Hysteresis distance in **pixels of the original captured frame** |
| `COUNTING_DIRECTION_IN` | Which signed-side transition maps to `in` |
| `COUNTING_ANCHOR` | `bottom_center` or bounding-box `center` |
| `COUNTING_REARM_SECONDS` | Minimum separation between genuine crossing events on one track |
| `PERSON_CAPTURE_DIRECTION` | `both` by default in Phase 5; may be restricted to `in` or `out` operationally |
| `PERSON_CAPTURE_BUFFER_SECONDS` | Maximum age of bounded best-frame candidates |
| `PERSON_CAPTURE_MAX_CANDIDATES` | Maximum candidate crops retained per active person track |
| `HEAD_DETECTION_MODEL_PATH` | Reviewed head-object detector used only after crossing |
| `API_TIMEOUT_SECONDS` | HTTP connect/read/write/pool timeout |
| `EVENT_RETRY_INITIAL_SECONDS` | First transient delivery retry delay |
| `EVENT_RETRY_MAX_SECONDS` | Backoff and authentication-pause ceiling |
| `HEARTBEAT_INTERVAL_SECONDS` | Camera connectivity report cadence |
| `METRICS_INTERVAL_SECONDS` | Performance log cadence |
| `EVENT_QUEUE_DATABASE` | SQLite path relative to `cv/` unless absolute |
| `EVENT_QUEUE_MAX_PENDING` | Pending count that pauses inference; events are not silently dropped |
| `EVENT_QUEUE_RETAIN_DELIVERED` | Keep delivered audit rows instead of deleting them |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` |

Line orientation matters. Reversing its endpoints reverses signed sides and therefore IN/OUT unless `COUNTING_DIRECTION_IN` is changed too.

Per-camera YAML values can override FPS, inference size, preview limits, counting line, direction, margin, anchor, and person-candidate minimum confidence/width/height. Candidate overrides do not change YOLO tracking or counting thresholds; they only account for different lens scale when selecting a post-crossing crop. Never place RTSP URLs or credentials in YAML.
