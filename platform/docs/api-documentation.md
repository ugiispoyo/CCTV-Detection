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
| Internal CV | `POST /internal/cv/person-captures` | Bearer-authenticated dual-image crossing capture |
| Person Captures | `GET /api/person-captures/:id/images/full-body|head` | Protected private images |
| Dataset | `/api/dataset/annotations`, `/api/dataset/exports`, `/api/dataset/versions` | Protected annotation/version workflow |
| Models | `/api/models/versions` | Candidate metrics, approval, and explicit activation registry |
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

## Person capture and labeling

- `POST /internal/cv/person-captures` accepts an authenticated, idempotent person crop.
- `GET /api/person-captures` supports pagination plus camera, review-status, and `direction=in|out` filters.
- `GET /api/person-captures/quality-metrics` reports crossing-to-capture, current full-body/head availability, and review outcomes per camera and direction. Its response states retention and ground-truth limitations.
- `DELETE /api/person-captures/:captureId` with `{ "confirmed": true }` permanently removes a pending or dismissed capture, its private JPEGs, and non-approved annotation drafts. Reviewed/linked or dataset-approved captures return `409`.
- Capture detail, non-static JPEG retrieval, review, and explicit verification use `/api/person-captures/:captureId` subroutes.
- `GET|POST /api/people` and `GET|PATCH /api/people/:personId` manage minimal profiles.
- Credential creation, revocation, and verification routes are rate limited and store only HMAC verifiers.

CV ingestion requires the service Bearer token. Sensitive routes require `X-Operator-Token`; verification requires `confirmed: true`. Capture ingestion includes `lineId`, `direction`, full-body JPEG, and optional head JPEG. There is no biometric matching.

Dataset annotation creation rejects identical bounding boxes for the same capture/image/class. Corrections and approval/rejection transitions are audit-recorded. Candidate model versions support separate approve, reject, and activate operations; none deploy a weight file automatically.
