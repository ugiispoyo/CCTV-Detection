import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env.js";
import { CameraModel } from "../cameras/camera.model.js";
import { isValidServiceAuthorization } from "../internal-cv/internal-cv.auth.js";
import { PreviewRegistry } from "./preview.registry.js";
import { parsePreviewFrame, parsePreviewObjects, parseRegistration } from "./preview.types.js";

export const livePreviewRoutes: FastifyPluginAsync = async (app) => {
  const registry = new PreviewRegistry(app.log);
  const staleTimer = setInterval(() => registry.pruneStale(), env.LIVE_PREVIEW_STALE_SECONDS * 1000);
  staleTimer.unref();
  app.addHook("onClose", async () => clearInterval(staleTimer));

  app.get("/internal/cv/preview", { websocket: true }, (socket, request) => {
    if (!env.LIVE_PREVIEW_ENABLED) return socket.close(1013, "Live preview disabled");
    if (!isValidServiceAuthorization(request.headers.authorization)) {
      request.log.warn("Unauthorized live preview publisher rejected");
      return socket.close(1008, "Unauthorized");
    }
    let cameraId: string | undefined;
    let registering = false;
    socket.on("message", async (data, isBinary) => {
      if (!cameraId) {
        if (isBinary || registering) return socket.close(1008, "Registration required");
        const registration = parseRegistration(data.toString());
        if (!registration) return socket.close(1008, "Invalid registration");
        registering = true;
        try {
          const camera = await CameraModel.findOne({ cameraId: registration.cameraId }).select({ isActive: 1, lastWorkerId: 1 }).lean();
          if (!camera?.isActive) return socket.close(1008, "Camera unavailable");
          if (camera.lastWorkerId && camera.lastWorkerId !== registration.workerId) return socket.close(1008, "Worker does not own camera");
          if (!registry.registerPublisher(registration.cameraId, registration.workerId, socket)) return socket.close(1008, "Publisher already active");
          cameraId = registration.cameraId;
          registering = false;
          request.log.info({ cameraId, workerId: registration.workerId }, "Live preview publisher registered");
          socket.send(JSON.stringify({ type: "preview.registered", version: 1, cameraId, staleSeconds: env.LIVE_PREVIEW_STALE_SECONDS }));
        } catch (error) {
          request.log.error({ err: error }, "Live preview camera validation failed");
          socket.close(1011, "Camera validation failed");
        }
        return;
      }
      if (!isBinary) {
        const objects = parsePreviewObjects(data.toString());
        if (!objects || !registry.publishObjects(cameraId, socket, objects)) socket.close(1008, "Invalid preview metadata");
        return;
      }
      const packet = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const metadata = parsePreviewFrame(packet, env.LIVE_PREVIEW_MAX_FRAME_BYTES);
      if (!metadata || !registry.publish(cameraId, socket, packet, metadata)) {
        request.log.warn({ cameraId, bytes: packet.length }, "Invalid live preview frame rejected");
        socket.close(1008, "Invalid preview frame");
      }
    });
    socket.once("close", () => {
      if (cameraId) {
        registry.removePublisher(cameraId, socket);
        request.log.info({ cameraId }, "Live preview publisher disconnected");
      }
    });
    socket.once("error", (error) => request.log.warn({ err: error, cameraId }, "Live preview publisher socket error"));
  });

  app.get("/ws/cameras/:cameraId/live", { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    const cameraId = (request.params as { cameraId?: string }).cameraId;
    if (!env.LIVE_PREVIEW_ENABLED) return socket.close(1013, "Live preview disabled");
    if (!origin || !env.CORS_ORIGIN.includes(origin)) return socket.close(1008, "Origin not allowed");
    if (!cameraId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(cameraId)) return socket.close(1008, "Invalid camera ID");
    void CameraModel.exists({ cameraId, isActive: true }).then((exists) => {
      if (!exists) return socket.close(1008, "Camera unavailable");
      if (socket.readyState !== socket.OPEN) return;
      if (!registry.addSubscriber(cameraId, socket)) return socket.close(1013, "Subscriber limit reached");
      request.log.info({ cameraId }, "Live preview subscriber connected");
      socket.once("close", () => request.log.info({ cameraId }, "Live preview subscriber disconnected"));
    }).catch((error: unknown) => {
      request.log.error({ err: error, cameraId }, "Live preview subscriber camera validation failed");
      socket.close(1011, "Camera validation failed");
    });
  });
};

