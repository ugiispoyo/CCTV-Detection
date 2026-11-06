# Fastify API integration

The service was implemented against the actual sibling platform schemas, not an assumed contract.

## Authentication and registration

Every `/internal/cv/*` request sends `Authorization: Bearer <CV_SERVICE_TOKEN>`. The token remains local and is never written into queue payloads or logs. `GET /internal/cv/config` must contain every enabled logical camera ID with person, car, and motorcycle allowed. An unregistered YAML camera is skipped without stopping other valid runtimes.

The platform currently returns `countingLine: null`; it does not accept RTSP settings or secrets. Local `.env` is therefore authoritative for the Phase 2 line and stream URL.

The preview publisher connects to `WS /internal/cv/preview` with the same Bearer header, registers `cameraId` and `workerId`, then sends versioned binary JPEG packets. The token is never put in a URL. Preview delivery is lossy/latest-frame-only and independent from the durable event API. See [live preview](live-preview.md).

## Event payload

```json
{
  "eventId": "018f65c4-20d9-7da8-9a4e-5e3519b82f32",
  "cameraId": "cam-001",
  "sessionId": "25e1bac0-4f59-41d0-bb2c-5967b43a9ef0",
  "trackId": 15,
  "objectType": "motorcycle",
  "eventType": "line_crossing",
  "direction": "in",
  "confidence": 0.94,
  "timestamp": "2026-11-06T03:00:00Z"
}
```

The SQLite row is inserted before `POST /internal/cv/events`. HTTP 200 or 201 completes it; the platform's explicit duplicate result is HTTP 200 and is also complete. HTTP 429 honors `Retry-After`; network failures and 5xx retry with exponential backoff and jitter. HTTP 400/404/409/422 are retained as invalid for operator review. Specifically, this platform uses 409 for an inactive camera, not duplicate acknowledgement. HTTP 401/403 pauses attempts until the token is corrected.

## Heartbeat

```json
{
  "workerId": "cv-worker-001",
  "cameraId": "cam-001",
  "status": "online",
  "timestamp": "2026-11-06T03:00:00Z"
}
```

Each logical camera has an independent heartbeat. Status is online only when that capture is connected and has a recent frame. One offline lens does not change another lens's status. API failures do not crash inference. The current platform schema does not accept FPS or latency fields, so performance metrics remain local logs.

## Contract differences and required future API work

No platform change is required for Phase 2. For centralized line configuration later, extend `GET /internal/cv/config` from `countingLine: null` to a versioned normalized-line object. For separate worker connectivity and verified stream health, add distinct fields rather than interpreting one camera status as both.
