import type { RealtimeMessage } from "@cctv-ai/shared";
import type { WebSocket } from "ws";

export class RealtimeBroker {
  private readonly clients = new Set<WebSocket>();
  private readonly operatorClients = new Set<WebSocket>();

  add(client: WebSocket, operator = false): void {
    this.clients.add(client);
    if (operator) this.operatorClients.add(client);
    const remove = () => { this.clients.delete(client); this.operatorClients.delete(client); };
    client.on("close", remove);
    client.on("error", remove);
  }

  publish(message: RealtimeMessage, options: { operatorOnly?: boolean } = {}): void {
    const serialized = JSON.stringify(message);
    for (const client of options.operatorOnly ? this.operatorClients : this.clients) {
      if (client.readyState === client.OPEN) client.send(serialized);
    }
  }
}
