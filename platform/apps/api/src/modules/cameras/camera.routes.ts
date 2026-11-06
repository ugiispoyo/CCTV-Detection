import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok } from "../../lib/schemas.js";
import { cameraListQuerySchema, cameraListResponseSchema, cameraParamsSchema, cameraResponseSchema, createCameraSchema, updateCameraSchema } from "./camera.schema.js";
import { createCamera, deactivateCamera, getCamera, listCameras, updateCamera } from "./camera.service.js";

const errors = { 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 500: errorResponseSchema };

export const cameraRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/api/cameras", {
    schema: { tags: ["Cameras"], summary: "List cameras", querystring: cameraListQuerySchema, response: { 200: cameraListResponseSchema, ...errors } },
  }, async (request) => ok(await listCameras(request.query)));

  app.get("/api/cameras/:cameraId", {
    schema: { tags: ["Cameras"], summary: "Get camera details", params: cameraParamsSchema, response: { 200: cameraResponseSchema, ...errors } },
  }, async (request) => ok(await getCamera(request.params.cameraId)));

  app.post("/api/cameras", {
    schema: { tags: ["Cameras"], summary: "Create a camera", body: createCameraSchema, response: { 201: cameraResponseSchema, ...errors } },
  }, async (request, reply) => reply.code(201).send(ok(await createCamera(request.body))));

  app.patch("/api/cameras/:cameraId", {
    schema: { tags: ["Cameras"], summary: "Update a camera", params: cameraParamsSchema, body: updateCameraSchema, response: { 200: cameraResponseSchema, ...errors } },
  }, async (request) => ok(await updateCamera(request.params.cameraId, request.body)));

  app.delete("/api/cameras/:cameraId", {
    schema: { tags: ["Cameras"], summary: "Safely deactivate a camera", params: cameraParamsSchema, response: { 200: cameraResponseSchema, ...errors } },
  }, async (request) => ok(await deactivateCamera(request.params.cameraId)));
};
