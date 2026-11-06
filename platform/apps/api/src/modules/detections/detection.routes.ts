import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok } from "../../lib/schemas.js";
import { detectionListResponseSchema, detectionParamsSchema, detectionQuerySchema, detectionResponseSchema } from "./detection.schema.js";
import { getDetection, listDetections } from "./detection.service.js";

export const detectionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/api/detections", {
    schema: { tags: ["Detections"], summary: "List and filter detection events", querystring: detectionQuerySchema, response: { 200: detectionListResponseSchema, 400: errorResponseSchema, 500: errorResponseSchema } },
  }, async (request) => ok(await listDetections(request.query)));
  app.get("/api/detections/:eventId", {
    schema: { tags: ["Detections"], summary: "Get detection event details", params: detectionParamsSchema, response: { 200: detectionResponseSchema, 404: errorResponseSchema, 500: errorResponseSchema } },
  }, async (request) => ok(await getDetection(request.params.eventId)));
};
