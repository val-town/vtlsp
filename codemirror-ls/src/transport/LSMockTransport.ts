import { vi } from "vitest";
import type { LSITransport } from "./LSITransport.js";

/**
 * Mock implementation of LSITransport for testing.
 */
export class LSMockTransport implements LSITransport {
  public notificationHandlers: Array<
    (method: string, params: unknown) => void
  > = [];
  public requestHandlers: Array<(method: string, params: unknown) => unknown> =
    [];
  public errorHandlers: Array<(error: unknown) => void> = [];

  public sendNotification = vi.fn();
  public sendRequest = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  public close = vi.fn();

  public reset(): void {
    this.sendNotification.mockClear();
    this.sendRequest.mockClear();
    this.close.mockClear();
    this.notificationHandlers = [];
    this.requestHandlers = [];
    this.errorHandlers = [];
  }

  constructor() {
    this.sendRequest.mockResolvedValueOnce({
      capabilities: {},
      serverInfo: {
        name: "language-server",
        version: "1.0.0",
      },
    });
  }

  onNotification(
    handler: (method: string, params: unknown) => void,
  ): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      const index = this.notificationHandlers.indexOf(handler);
      if (index > -1) {
        this.notificationHandlers.splice(index, 1);
      }
    };
  }

  onRequest(handler: (method: string, params: unknown) => unknown): () => void {
    this.requestHandlers.push(handler);
    return () => {
      const index = this.requestHandlers.indexOf(handler);
      if (index > -1) {
        this.requestHandlers.splice(index, 1);
      }
    };
  }

  onError(handler: (error: unknown) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const index = this.errorHandlers.indexOf(handler);
      if (index > -1) {
        this.errorHandlers.splice(index, 1);
      }
    };
  }

  simulateNotification(method: string, params?: unknown): void {
    this.notificationHandlers.forEach((handler) => handler(method, params));
  }

  simulateRequest(method: string, params?: unknown): unknown {
    if (this.requestHandlers.length > 0) {
      return this.requestHandlers[0]?.(method, params);
    }
    return undefined;
  }

  simulateError(error: unknown): void {
    this.errorHandlers.forEach((handler) => handler(error));
  }
}
