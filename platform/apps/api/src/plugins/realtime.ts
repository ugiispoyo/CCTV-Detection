import websocket from "@fastify/websocket";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { RealtimeBroker } from "../websocket/broker.js";

declare module "fastify" {
  interface FastifyInstance { realtime: RealtimeBroker }
}

export const realtimePlugin = fp(async (app) => {
  await app.register(websocket);
  const broker = new RealtimeBroker();
  app.decorate("realtime", broker);
  app.get("/ws", { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (!origin || !env.CORS_ORIGIN.includes(origin)) {
      socket.close(1008, "Origin not allowed");
      return;
    }
    broker.add(socket);
    socket.send(JSON.stringify({ type: "connection.ready", data: { timestamp: new Date().toISOString() } }));
  });
});
