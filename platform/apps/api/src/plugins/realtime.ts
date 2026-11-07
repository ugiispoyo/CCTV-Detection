import websocket from "@fastify/websocket";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { RealtimeBroker } from "../websocket/broker.js";
import { isValidOperatorProtocol } from "./operator-auth.js";

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
    const protocol = request.headers["sec-websocket-protocol"]?.split(",").map((value) => value.trim()).find((value) => value.startsWith("cctv-operator."));
    broker.add(socket, isValidOperatorProtocol(protocol));
    socket.send(JSON.stringify({ type: "connection.ready", data: { timestamp: new Date().toISOString() } }));
  });
});
