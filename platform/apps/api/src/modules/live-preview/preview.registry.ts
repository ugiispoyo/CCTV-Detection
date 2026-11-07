import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";
import { env } from "../../config/env.js";
import type { PreviewFrameMetadata, PreviewObjectsMessage } from "./preview.types.js";
import { updateActiveTracks } from "./track-activity.js";

interface PublisherSession { socket: WebSocket; workerId: string }
interface LatestFrame { packet: Buffer; metadata: PreviewFrameMetadata; receivedAt: number }

export class PreviewRegistry {
  private readonly publishers = new Map<string, PublisherSession>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();
  private readonly latest = new Map<string, LatestFrame>();
  private readonly latestObjects = new Map<string, PreviewObjectsMessage>();
  private readonly slowStrikes = new WeakMap<WebSocket, number>();

  constructor(private readonly log: FastifyBaseLogger) {}

  registerPublisher(cameraId: string, workerId: string, socket: WebSocket): boolean {
    const current = this.publishers.get(cameraId);
    if (current && current.socket.readyState === current.socket.OPEN) return false;
    this.publishers.set(cameraId, { socket, workerId });
    this.broadcastControl(cameraId, "camera.preview.started");
    return true;
  }

  removePublisher(cameraId: string, socket: WebSocket): void {
    if (this.publishers.get(cameraId)?.socket !== socket) return;
    this.publishers.delete(cameraId);
    this.latest.delete(cameraId);
    this.latestObjects.delete(cameraId);
    this.broadcastControl(cameraId, "camera.preview.stopped");
  }

  addSubscriber(cameraId: string, socket: WebSocket): boolean {
    const group = this.subscribers.get(cameraId) ?? new Set<WebSocket>();
    if (group.size >= env.LIVE_PREVIEW_MAX_SUBSCRIBERS_PER_CAMERA) return false;
    group.add(socket);
    this.subscribers.set(cameraId, group);
    socket.once("close", () => this.removeSubscriber(cameraId, socket));
    socket.once("error", () => this.removeSubscriber(cameraId, socket));
    this.sendControl(socket, this.publishers.has(cameraId) ? "camera.preview.started" : "camera.preview.stopped", cameraId);
    const latest = this.latest.get(cameraId);
    if (latest && Date.now() - latest.receivedAt <= env.LIVE_PREVIEW_STALE_SECONDS * 1000) socket.send(latest.packet, { binary: true });
    const objects = this.latestObjects.get(cameraId);
    if (objects) socket.send(JSON.stringify({ ...objects, cameraId }));
    return true;
  }

  publishObjects(cameraId: string, socket: WebSocket, message: PreviewObjectsMessage): boolean {
    if (this.publishers.get(cameraId)?.socket !== socket) return false;
    this.latestObjects.set(cameraId, message);
    updateActiveTracks(cameraId, message.sessionId, message.tracks);
    const serialized = JSON.stringify({ ...message, cameraId });
    for (const subscriber of this.subscribers.get(cameraId) ?? []) {
      if (subscriber.readyState === subscriber.OPEN && subscriber.bufferedAmount <= env.LIVE_PREVIEW_MAX_FRAME_BYTES * 2) subscriber.send(serialized);
    }
    return true;
  }

  publish(cameraId: string, socket: WebSocket, packet: Buffer, metadata: PreviewFrameMetadata): boolean {
    if (this.publishers.get(cameraId)?.socket !== socket) return false;
    const stablePacket = Buffer.from(packet);
    this.latest.set(cameraId, { packet: stablePacket, metadata, receivedAt: Date.now() });
    for (const subscriber of this.subscribers.get(cameraId) ?? []) {
      if (subscriber.readyState !== subscriber.OPEN) continue;
      if (subscriber.bufferedAmount > env.LIVE_PREVIEW_MAX_FRAME_BYTES * 2) {
        const strikes = (this.slowStrikes.get(subscriber) ?? 0) + 1;
        this.slowStrikes.set(subscriber, strikes);
        if (strikes >= 10) subscriber.close(1013, "Preview subscriber too slow");
        continue;
      }
      this.slowStrikes.set(subscriber, 0);
      subscriber.send(stablePacket, { binary: true }, (error) => {
        if (error) this.log.warn({ cameraId, err: error }, "Live preview subscriber send failed");
      });
    }
    return true;
  }

  pruneStale(): void {
    const cutoff = Date.now() - env.LIVE_PREVIEW_STALE_SECONDS * 1000;
    for (const [cameraId, frame] of this.latest) {
      if (frame.receivedAt < cutoff) this.latest.delete(cameraId);
    }
  }

  private removeSubscriber(cameraId: string, socket: WebSocket): void {
    const group = this.subscribers.get(cameraId);
    group?.delete(socket);
    if (group?.size === 0) this.subscribers.delete(cameraId);
  }

  private broadcastControl(cameraId: string, type: string): void {
    for (const socket of this.subscribers.get(cameraId) ?? []) this.sendControl(socket, type, cameraId);
  }

  private sendControl(socket: WebSocket, type: string, cameraId: string): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, version: 1, cameraId, staleSeconds: env.LIVE_PREVIEW_STALE_SECONDS, timestamp: new Date().toISOString() }));
  }
}

