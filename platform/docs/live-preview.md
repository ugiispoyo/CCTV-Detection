# Live preview protocol and operations

The `/live` dashboard page lists active cameras through REST, decodes version-1 JPEG packets into canvases, and reports effective receive FPS and freshness. Single View subscribes to one logical camera. Grid View subscribes once per logical camera in the selected `physicalCameraId` group and stacks feeds on smaller screens. Switching modes/cameras closes obsolete sockets. Start/stop controls affect only browser subscriptions; Python inference and counting continue.

Each feed queries statistics with its own logical camera ID. Grid totals are crossing events, not unique people when lens views overlap.

Fastify stores at most one frame per camera in process memory. It rejects a second active publisher, oversized or malformed packets, unknown/inactive cameras, invalid tokens, disallowed browser origins, and excess subscribers. Slow subscriber buffers cause frame drops and eventual close. Nothing is written to MongoDB or disk.

Publisher and subscriber must currently reach the same Fastify process. Configure a trusted local network and explicit `CORS_ORIGIN`; no user authentication exists. Do not publish this stream on the internet or through a tunnel. For multiple API replicas or higher-quality/high-FPS streaming, use a properly authenticated WebRTC or streaming gateway in a later phase.

Required API variables:

```dotenv
LIVE_PREVIEW_ENABLED=true
LIVE_PREVIEW_MAX_FRAME_BYTES=524288
LIVE_PREVIEW_MAX_SUBSCRIBERS_PER_CAMERA=5
LIVE_PREVIEW_STALE_SECONDS=10
```
