# Troubleshooting

## RTSP connection refused or camera offline

Confirm reachability, port, vendor path, and that the camera allows another session. Open the URL in VLC. TCP is the default; try UDP only if the camera/network requires it. Reconnect logs never include credentials.

### macOS reports `No route to host` but VLC works

If `ping` and `nc -vz CAMERA_IP 554` work but the CV service logs
`network_route_or_permission_denied`, the route and RTSP port are available and the Python
process host is being denied LAN access. VLC has a separate macOS Local Network permission.

Open **System Settings → Privacy & Security → Local Network** and enable access for the
application that launches Python (Terminal, iTerm, the IDE, or the relevant agent). Also check
VPN clients and endpoint/network filters for per-application LAN rules. Fully quit and reopen the
launcher after changing permission. The CV service performs a credential-free TCP preflight and
still lets FFmpeg make the authoritative attempt. On macOS, if both Python and OpenCV are denied
but VLC is installed and authorized, the service automatically starts VLC headlessly to decode the
RTSP stream into a bounded in-memory RGB pipe (`1280×720` at `10 FPS`) for OpenCV. No HTTP proxy,
snapshot, or video file is created. The credential is passed through a temporary `0600` playlist
and is never placed in process arguments or logs.

Diagnostic categories distinguish the stages:

- `network_*`: DNS, route, permission, TCP refusal, or TCP timeout before RTSP starts.
- `backend_*`: OpenCV was built without a usable FFmpeg backend or raised an open exception.
- `rtsp_open_failed`: TCP succeeded, but authentication, path, session limits, or codec negotiation failed.
- `rtsp_read_failed`: RTSP opened but frame reads stopped or timed out.

## Invalid camera credentials

Update only local `.env`. URL-encode reserved username/password characters. Never place RTSP credentials in Fastify camera configuration.

## MPS unavailable

Use `DEVICE=auto` or `cpu`. Confirm an arm64 Python/PyTorch wheel and supported macOS. `DEVICE=mps` intentionally fails rather than silently falling back.

## YOLO weight download failure

Check internet access, then rerun. For offline operation, place a compatible `yolo26n.pt` at `cv/models/yolo26n.pt`. The loader verifies COCO class names 0, 2, and 3.

## Missing dependencies

Activate `.venv`, verify Python 3.12, and reinstall `requirements.txt`. Do not mix the platform's Node environment with Python.

## API unreachable

Inference can start and events remain in SQLite. Confirm the Fastify API is listening at `API_BASE_URL`; delivery resumes automatically.

## Invalid service token

Ensure both projects use the same 32+ character value and restart the CV service. Authentication failures are logged without the token and delivery pauses instead of hammering the API.

## SQLite database locked

Run only one CV process against a queue file. Ensure `data/` is writable and local, not a network filesystem. WAL and a five-second busy timeout are enabled.

## Low FPS

Reduce `IMAGE_SIZE` or `TARGET_PROCESSING_FPS`, use `DEVICE=auto`, disable preview, and reduce camera resolution. Verify logs report `device=mps`. Actual FPS depends on scene, stream decoding, and model/hardware versions.

## Preview does not open

Local preview is intentionally unavailable. Use dashboard `/live`. `CV_HEADLESS=false` or `LOCAL_PREVIEW_ENABLED=true` is rejected at startup.

## Dashboard live preview is unavailable

Dashboard preview is controlled by `LIVE_PREVIEW_ENABLED`. Confirm Fastify and CV use the same service token, `CV_PREVIEW_WS_URL` ends in `/internal/cv/preview`, the camera is active, and both services were restarted. A healthy RTSP heartbeat does not prove the preview publisher is connected; look for `Preview publisher connected`.

## Validating another H9c lens

Use VLC's Open Network dialog with the exact candidate URL, or FFprobe with RTSP TCP, without placing credentials in shell history or logs. A likely channel number is not proof of lens identity. Confirm the image physically, stop the validation client, store the verified URL only in `.env`, register the logical camera in Fastify, then enable its YAML entry.

One failed RTSP stream reconnects independently and does not stop another logical camera.
