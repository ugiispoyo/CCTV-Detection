import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok } from "../../lib/schemas.js";
import { requireServiceToken } from "./internal-cv.auth.js";
import { cvConfigResponseSchema, cvEventResponseSchema, cvEventSchema, heartbeatResponseSchema, heartbeatSchema } from "./internal-cv.schema.js";
import { getWorkerConfig, ingestEvent, recordHeartbeat } from "./internal-cv.service.js";

const security = [{ bearerAuth: [] }];
const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema, 500: errorResponseSchema };

export const internalCvRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", requireServiceToken);

  app.post("/internal/cv/events", {
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
    schema: { tags: ["Internal CV"], summary: "Persist an idempotent counting event", security, body: cvEventSchema, response: { 200: cvEventResponseSchema, 201: cvEventResponseSchema, ...errors } },
  }, async (request, reply) => {
    const result = await ingestEvent(request.body);
    if (!result.duplicate) {
      app.realtime.publish({ type: "detection.created", data: result.event });
      app.realtime.publish({ type: "counting.updated", data: {
        cameraId: result.event.cameraId, objectType: result.event.objectType, direction: result.event.direction,
        count: result.summaryCount, timestamp: result.event.timestamp,
      } });
    }
    return reply.code(result.duplicate ? 200 : 201).send(ok({ event: result.event, duplicate: result.duplicate }));
  });

  app.post("/internal/cv/heartbeat", {
    bodyLimit: 32 * 1024,
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    schema: { tags: ["Internal CV"], summary: "Record a worker heartbeat", security, body: heartbeatSchema, response: { 200: heartbeatResponseSchema, ...errors } },
  }, async (request) => {
    const result = await recordHeartbeat(request.body);
    if (result.changed) app.realtime.publish({ type: "camera.status_changed", data: result });
    return ok({ cameraId: result.cameraId, status: result.status, lastHeartbeatAt: result.lastHeartbeatAt });
  });

  app.get("/internal/cv/config", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { tags: ["Internal CV"], summary: "Get non-secret active camera configuration", security, response: { 200: cvConfigResponseSchema, ...errors } },
  }, async () => ok(await getWorkerConfig()));
};
