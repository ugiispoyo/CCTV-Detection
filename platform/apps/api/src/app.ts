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
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { realtimePlugin } from "./plugins/realtime.js";
import { z } from "zod";

export async function buildApp() {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "request.headers.authorization", "MONGODB_URI", "CV_SERVICE_TOKEN"], censor: "[REDACTED]" },
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
        { name: "System" }, { name: "Cameras" }, { name: "Detections" }, { name: "Statistics" }, { name: "Internal CV" },
      ],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Service token" } } },
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
  return app;
}
