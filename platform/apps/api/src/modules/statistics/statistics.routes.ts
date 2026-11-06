import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok } from "../../lib/schemas.js";
import { cameraStatisticsParamsSchema, cameraSummaryResponseSchema, rangeQuerySchema, statisticsQuerySchema, summaryResponseSchema, timelineResponseSchema } from "./statistics.schema.js";
import { getSummary, getTimeline } from "./statistics.service.js";

export const statisticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/api/statistics/summary", {
    schema: { tags: ["Statistics"], summary: "Get overall counting summary", querystring: rangeQuerySchema, response: { 200: summaryResponseSchema, 400: errorResponseSchema, 500: errorResponseSchema } },
  }, async (request) => ok(await getSummary(request.query)));
  app.get("/api/statistics/cameras/:cameraId", {
    schema: { tags: ["Statistics"], summary: "Get camera-specific statistics", params: cameraStatisticsParamsSchema, querystring: rangeQuerySchema, response: { 200: cameraSummaryResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 500: errorResponseSchema } },
  }, async (request) => ok({ ...(await getSummary(request.query, request.params.cameraId)), cameraId: request.params.cameraId }));
  app.get("/api/statistics/timeline", {
    schema: { tags: ["Statistics"], summary: "Get hourly counting timeline", querystring: statisticsQuerySchema, response: { 200: timelineResponseSchema, 400: errorResponseSchema, 500: errorResponseSchema } },
  }, async (request) => ok(await getTimeline(request.query)));
};
