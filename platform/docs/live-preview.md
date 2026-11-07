# Live preview protocol and operations

The `/live` dashboard page lists active cameras through REST, decodes version-1 JPEG packets into canvases, and reports effective receive FPS and freshness. It opens in Grid View by default and subscribes once per logical camera in the selected `physicalCameraId` group; feeds stack on smaller screens. Single View remains available for one logical camera and its recent-event table. Switching modes/cameras closes obsolete sockets. Start/stop controls affect only browser subscriptions; Python inference and counting continue, and no additional RTSP reader is created.

Each feed queries statistics with its own logical camera ID. Grid totals are crossing events, not unique people when lens views overlap.

Each feed also displays `Visible now` counts received through `preview.objects`. The same ephemeral message includes normalized track boxes and the tracker session ID. It contains no names. Protected active-identity REST data is joined in the browser to draw authorized operator overlays; names are never embedded in JPEG packets.

Fastify stores at most one frame per camera in process memory. It rejects a second active publisher, oversized or malformed packets, unknown/inactive cameras, invalid tokens, disallowed browser origins, and excess subscribers. Slow subscriber buffers cause frame drops and eventual close. Nothing is written to MongoDB or disk.

Publisher and subscriber must currently reach the same Fastify process. Configure a trusted local network and explicit `CORS_ORIGIN`. The JPEG subscriber remains origin-restricted rather than operator-authenticated because it contains detection overlays only; resident names/profile data require operator access. Do not publish this stream on the internet or through a tunnel.

Required API variables:

```dotenv
LIVE_PREVIEW_ENABLED=true
LIVE_PREVIEW_MAX_FRAME_BYTES=524288
LIVE_PREVIEW_MAX_SUBSCRIBERS_PER_CAMERA=5
LIVE_PREVIEW_STALE_SECONDS=10
```
