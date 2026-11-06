# Live AI preview

The worker performs YOLO and ByteTrack once. After counting, `PreviewRenderer` copies that processed frame and draws allowed tracks, real IDs and confidence, the existing `LineCounter` geometry, local IN/OUT totals, processing FPS, and RTSP state. `JpegPreviewEncoder` preserves aspect ratio, caps width and quality, and rejects oversized output.

`PreviewPublisher` has a single latest-frame slot. Replacing an unsent frame increments its dropped-frame count; old frames are never retried or written to SQLite. Network latency therefore cannot block inference or counting. It reconnects independently with capped exponential backoff.

## Wire format

Each WebSocket binary message is a 32-byte big-endian header followed immediately by one JPEG:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | ASCII `CCTV` |
| 4 | 1 | protocol version `1` |
| 5 | 1 | flags, currently `0` |
| 6 | 2 | header length, `32` |
| 8 | 8 | unsigned sequence |
| 16 | 8 | UTC Unix timestamp milliseconds |
| 24 | 2 | width |
| 26 | 2 | height |
| 28 | 4 | JPEG byte length |

The initial text message is `preview.register`; Fastify replies with `preview.registered` before binary frames are allowed. The publisher uses an Authorization header, never a query token.

This preview is intended for trusted local deployment at approximately 2–10 FPS. WebRTC or a dedicated streaming gateway is a better future choice for high frame rates, many cameras, or remote/public viewing.
