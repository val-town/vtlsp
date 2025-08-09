import { Container } from "@cloudflare/containers";
import { app } from "./src/app.js";

export class VTLSPContainer extends Container {
  public override sleepAfter = 30; // seconds
  public override defaultPort = 5002;
  public override envVars = Object.fromEntries(
    Object.entries(process.env).filter(([_, value]) => value !== undefined) as [
      string,
      string,
    ][]
  );

  public readonly MAX_WS_CONNECTIONS = 10;

  #wsConnections: WebSocket[] = [];

  async containerFetch(
    requestOrUrl: Request | string | URL,
    portOrInit?: number | RequestInit,
    portParam?: number
  ): Promise<Response> {
    const response = await super.containerFetch(
      requestOrUrl,
      portOrInit,
      portParam
    );

    if (response.webSocket) {
      this.manageWebSocketConnection(response.webSocket);
    }

    return response;
  }

  private manageWebSocketConnection(newWebSocket: WebSocket): void {
    if (this.#wsConnections.length >= this.MAX_WS_CONNECTIONS) {
      const oldestWs = this.#wsConnections.shift();
      if (oldestWs) {
        oldestWs.close(1000, "Connection closed due to connection limit");
        console.log(
          `Closed oldest WebSocket connection to make room for a new one`
        );
      }
    }

    this.#wsConnections.push(newWebSocket);

    newWebSocket.addEventListener("close", () => {
      this.#wsConnections = this.#wsConnections.filter(
        (ws) => ws !== newWebSocket
      );
    });
  }
}

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
