# API documentation

Interactive schemas and examples are served from `/docs`; the generated OpenAPI JSON is at `/openapi.json`. Route schemas are the same Zod definitions used for runtime validation, avoiding a separate handwritten contract.

## Endpoints

| Group | Method and path | Purpose |
|---|---|---|
| System | `GET /health`, `GET /ready` | Liveness and MongoDB readiness |
| Cameras | `GET/POST /api/cameras` | Paginated list and create |
| Cameras | `GET/PATCH/DELETE /api/cameras/:cameraId` | Detail, update, and safe deactivation |
| Detections | `GET /api/detections`, `GET /api/detections/:eventId` | Filtered history and detail |
| Statistics | `GET /api/statistics/summary` | Overall object/direction counts |
| Statistics | `GET /api/statistics/cameras/:cameraId` | Camera counts |
| Statistics | `GET /api/statistics/timeline` | UTC hourly buckets for a reporting range |
| Internal CV | `POST /internal/cv/events` | Transactional, idempotent ingestion |
| Internal CV | `POST /internal/cv/heartbeat` | Latest worker status |
| Internal CV | `GET /internal/cv/config` | Active non-secret camera configuration |
| Live Preview | `WS /internal/cv/preview` | Bearer-authenticated CV JPEG publisher |
| Live Preview | `WS /ws/cameras/:cameraId/live` | Origin-validated browser subscription |

## Response and errors

```json
{ "success": true, "data": { "cameraId": "cam-001" } }
```

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid request" }
}
```

Lists return `data.items` and `data.pagination` with `page`, `limit`, `total`, and `totalPages`. Page numbers start at 1 and limits are capped at 100. Clients cannot submit arbitrary sort or MongoDB query objects.

Detection filters are `cameraId`, `objectType`, `direction`, `startDate`, and `endDate`; timestamps are ISO 8601 with an offset and the end is exclusive. Statistics accept `range=today|yesterday|7d|30d|custom`, optional `timezone`, and for custom ranges both `startDate` and `endDate`. Timeline also accepts `cameraId`.

## Examples

Create a camera:

```bash
curl -X POST http://localhost:5005/api/cameras \
  -H 'content-type: application/json' \
  -d '{"cameraId":"cam-001","name":"Front entrance","location":"Lobby"}'
```

Submit an event using a shell-provided secret (never put a production token in source code):

```bash
curl -X POST http://localhost:5005/internal/cv/events \
  -H "authorization: Bearer $CV_SERVICE_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"eventId":"cam-001-session-a-42-in","cameraId":"cam-001","sessionId":"session-a","trackId":42,"objectType":"person","eventType":"line_crossing","direction":"in","confidence":0.94,"timestamp":"2026-11-06T03:00:00Z"}'
```

The first accepted delivery returns `201` with `duplicate:false`. A later delivery of the same `eventId` returns `200` with `duplicate:true` and does not increment a counter. Unknown cameras return `404`; inactive cameras return `409`; missing or invalid tokens return `401`.

Camera `DELETE` is intentionally a soft operation: it sets the camera inactive/offline and preserves detections and summaries.

Camera create/update accepts optional `physicalCameraId` and `lensName`. These are presentation metadata for grouping logical lenses; all persistence, heartbeat, statistics, and preview routing continue using `cameraId`.

## Live preview WebSocket

The worker first sends `{"type":"preview.register","version":1,"cameraId":"cam-001","workerId":"cv-worker-001"}` and waits for `preview.registered`. Binary messages then contain the documented 32-byte big-endian header plus JPEG payload. Fastify validates camera activity, publisher ownership, header fields, JPEG markers, dimensions, and size before relaying. Browser subscribers never receive or send the service token. See [live preview protocol](live-preview.md).
