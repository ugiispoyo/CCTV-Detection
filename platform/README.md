# CCTV AI Monitoring

Local-first CCTV counting and live AI monitoring platform. This npm-workspace project contains a Fastify/MongoDB API, React dashboard, and shared contracts. The independent sibling `../cv/` owns RTSP, YOLO, ByteTrack, counting, and annotated preview production.

## Stack

- Node.js 24 LTS, npm workspaces, strict TypeScript
- Fastify 5, Mongoose, Zod, Swagger/OpenAPI, WebSocket, Pino
- React 19, Vite, Tailwind CSS, React Router, TanStack Query, Axios, Recharts, Lucide
- MongoDB (a replica set or sharded cluster is required for transactional event ingestion)

## Repository

```text
apps/api/         Fastify API and MongoDB models
apps/dashboard/   Vite React dashboard
packages/shared/  Cross-application TypeScript contracts
docs/             Architecture, API, and Phase 2 integration guides
```

## Prerequisites

- Node.js 24.11 or newer patched Node 24 release (`24.x`)
- npm 11+
- MongoDB 7+ configured as a replica set, including a single-node replica set for local development

MongoDB transactions are mandatory because each accepted event and its hourly summary update commit atomically. A plain standalone `mongod` can serve reads and camera management but rejects CV event transactions.

## Install and configure

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

Set `MONGODB_URI` and generate a service token of at least 32 random characters. For example, use a password manager or `openssl rand -hex 32`; never commit the result. A typical local replica-set URI is:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
CV_SERVICE_TOKEN=<random-secret-at-least-32-characters>
```

The API loads `apps/api/.env` when launched through its workspace. Required values fail startup with a clear configuration error. The API defaults to `127.0.0.1:5005`; the dashboard is fixed to `127.0.0.1:5173` and fails when that port is occupied.

## Run

In separate terminals:

```bash
npm run dev:api
npm run dev:dashboard
```

Open the dashboard at `http://localhost:5173` and Swagger UI at `http://localhost:5005/docs`. The OpenAPI document is at `http://localhost:5005/openapi.json`.

## Build and typecheck

```bash
npm run typecheck
npm run build:api
npm run build:dashboard
```

Production starts use `npm run start -w @cctv-ai/api` after building. Supply environment variables through the process environment or the API workspace `.env` file.

## Environment variables

API: `NODE_ENV`, `HOST`, `PORT`, `MONGODB_URI`, `MONGODB_DB_NAME`, `CV_SERVICE_TOKEN`, `CORS_ORIGIN` (comma-separated allowlist), `REPORT_TIMEZONE`, `HEARTBEAT_TIMEOUT_SECONDS`, and `LOG_LEVEL`.

Dashboard: `VITE_API_URL` and `VITE_WS_URL`. The operator token is entered at runtime and kept in session storage; `VITE_OPERATOR_TOKEN` is available only for controlled kiosk deployments. No CV service token or database credential belongs in a `VITE_*` variable.

Person labeling fails closed unless a separate 32+ character `OPERATOR_TOKEN` is configured and supplied as `X-Operator-Token`. Configure private storage, retention, `CREDENTIAL_PEPPER`, dataset export, and active-identity TTL independently. Keep the API on a controlled network even with this minimal operator boundary.

Live preview API settings are `LIVE_PREVIEW_ENABLED`, `LIVE_PREVIEW_MAX_FRAME_BYTES`, `LIVE_PREVIEW_MAX_SUBSCRIBERS_PER_CAMERA`, and `LIVE_PREVIEW_STALE_SECONDS`. Open `/live`, select an active camera, and start the preview. Browser frames are relayed in memory only; restart both API and CV after first enabling the feature.

Optional camera fields `physicalCameraId` and `lensName` group logical lens records in Live Monitoring without changing event/statistics IDs. Single View subscribes to one lens; Grid View subscribes to the active lenses in one physical group.

## Troubleshooting

- **Startup reports invalid environment configuration:** fill in `MONGODB_URI` and a 32+ character `CV_SERVICE_TOKEN`.
- **Transaction numbers are only allowed…:** run MongoDB as a replica set and use a URI containing `replicaSet`.
- **Dashboard port is already in use:** stop the process on `5173`; strict port mode deliberately prevents silent switching.
- **WebSocket closes immediately:** its browser `Origin` must exactly match an entry in `CORS_ORIGIN`.
- **Camera appears offline:** the latest online heartbeat exceeded `HEARTBEAT_TIMEOUT_SECONDS`; a worker report is not permanent camera health.

See [architecture](docs/architecture.md), [API usage](docs/api-documentation.md), and [CV integration](docs/cv-integration.md).
The protected review workflow is documented in [person labeling](docs/person-labeling.md), and the directional capture/dataset increment in [Phase 5](docs/phase-5.md).
