import type { RealtimeMessage } from "@cctv-ai/shared";
import type { WebSocket } from "ws";

export class RealtimeBroker {
  private readonly clients = new Set<WebSocket>();

  add(client: WebSocket): void {
    this.clients.add(client);
    client.on("close", () => this.clients.delete(client));
    client.on("error", () => this.clients.delete(client));
  }

  publish(message: RealtimeMessage): void {
    const serialized = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(serialized);
    }
  }
}
