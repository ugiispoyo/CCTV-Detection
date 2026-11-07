import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { isDatabaseReady } from "./database/mongoose.js";
import { errorResponseSchema, ok, successSchema } from "./lib/schemas.js";
import { cameraRoutes } from "./modules/cameras/camera.routes.js";
import { detectionRoutes } from "./modules/detections/detection.routes.js";
import { internalCvRoutes } from "./modules/internal-cv/internal-cv.routes.js";
import { livePreviewRoutes } from "./modules/live-preview/preview.routes.js";
import { statisticsRoutes } from "./modules/statistics/statistics.routes.js";
import { personCaptureRoutes } from "./modules/person-captures/person-capture.routes.js";
import { peopleRoutes } from "./modules/people/person.routes.js";
import { enforcePersonCaptureRetention, ensurePersonCaptureIndexes } from "./modules/person-captures/person-capture.service.js";
import { ensurePeopleIndexes } from "./modules/people/person.service.js";
import { ensureCaptureStorage } from "./modules/person-captures/person-capture.storage.js";
import { datasetRoutes } from "./modules/datasets/dataset.routes.js";
import { ensureDatasetIndexes } from "./modules/datasets/dataset.service.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { realtimePlugin } from "./plugins/realtime.js";
import { z } from "zod";

export async function buildApp() {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "request.headers.authorization", "req.headers.x-operator-token", "request.headers.x-operator-token", "req.headers.sec-websocket-protocol", "request.headers.sec-websocket-protocol", "MONGODB_URI", "CV_SERVICE_TOKEN", "OPERATOR_TOKEN", "CREDENTIAL_PEPPER"], censor: "[REDACTED]" },
    },
    requestIdHeader: "x-request-id",
    genReqId: (request) => request.headers["x-request-id"]?.toString() ?? crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: false, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "CCTV AI Monitoring API", description: "Phase 1 REST and CV worker integration API", version: "0.1.0" },
      tags: [
        { name: "System" }, { name: "Cameras" }, { name: "Detections" }, { name: "Statistics" }, { name: "Internal CV" }, { name: "Person Captures" }, { name: "Registered People" }, { name: "Detection Dataset" }, { name: "Detection Models" },
      ],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Service token" }, operatorAuth: { type: "apiKey", in: "header", name: "X-Operator-Token" } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list", deepLinking: true } });
  await app.register(realtimePlugin);
  await app.register(errorHandlerPlugin);

  const healthSchema = successSchema(z.object({ status: z.string(), timestamp: z.string(), database: z.string().optional() }));
  app.get("/health", { schema: { tags: ["System"], summary: "API liveness", response: { 200: healthSchema } } }, async () => ok({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/ready", { schema: { tags: ["System"], summary: "MongoDB readiness", response: { 200: healthSchema, 503: errorResponseSchema } } }, async (_request, reply) => {
    if (!isDatabaseReady()) return reply.code(503).send({ success: false, error: { code: "NOT_READY", message: "MongoDB is not connected" } });
    return ok({ status: "ready", database: "connected", timestamp: new Date().toISOString() });
  });
  app.get("/openapi.json", { schema: { tags: ["System"], summary: "Get the generated OpenAPI specification" } }, async (_request, reply) => reply.type("application/json").send(app.swagger()));

  await app.register(cameraRoutes);
  await app.register(detectionRoutes);
  await app.register(statisticsRoutes);
  await app.register(internalCvRoutes);
  await app.register(livePreviewRoutes);
  await app.register(personCaptureRoutes);
  await app.register(peopleRoutes);
  await app.register(datasetRoutes);
  await ensureCaptureStorage();
  const retentionTimer = setInterval(() => void enforcePersonCaptureRetention().catch((error: unknown) => app.log.error({ err: error }, "Person capture retention failed")), 6 * 60 * 60 * 1000);
  retentionTimer.unref();
  app.addHook("onReady", async () => {
    if (!isDatabaseReady()) { app.log.warn("Skipping database startup maintenance because MongoDB is not connected"); return; }
    await ensurePersonCaptureIndexes();
    await ensurePeopleIndexes();
    await ensureDatasetIndexes();
    const removed = await enforcePersonCaptureRetention();
    if (removed) app.log.info({ removed }, "Expired person capture images removed");
  });
  app.addHook("onClose", async () => clearInterval(retentionTimer));
  return app;
}
