import { afterEach, describe, expect, it, vi } from "vitest";
import { LSWebSocketTransport } from "./LSWebSocketTransport.js";

/**
 * A minimal stand-in for the browser WebSocket, enough for the transport to
 * establish a message connection and attempt writes.
 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  #listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, new Set());
    }
    this.#listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.#listeners.get(type)?.delete(listener);
  }

  send(_data: string | ArrayBuffer) {}

  close(_code?: number, _reason?: string) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code: _code, reason: _reason, type: "close" });
  }

  emit(type: string, event: unknown) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("LSWebSocketTransport.sendNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("does not leak an unhandled rejection when the socket has closed; the error is emitted instead", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const transport = new LSWebSocketTransport("ws://localhost:1234");
    const errorEvents: unknown[] = [];
    transport.onError((error) => errorEvents.push(error));

    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open", { type: "open" });
    await connecting;

    // Simulate the socket dying without a close event having fired yet, like
    // when messages are in flight while the socket is closing.
    socket.readyState = FakeWebSocket.CLOSED;
    transport.sendNotification("textDocument/didChange", {});

    await vi.waitFor(() => expect(errorEvents).toHaveLength(1));
    // Wait a macrotask for any unhandled rejection to surface.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);

    const [error] = errorEvents[0] as [Error, unknown, unknown];
    expect(error.message).toBe("WebSocket is not open");

    process.off("unhandledRejection", onUnhandled);
  });

  it("still throws when the transport is disposed", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = new LSWebSocketTransport("ws://localhost:1234");
    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open", { type: "open" });
    await connecting;

    transport.dispose();

    expect(() => transport.sendNotification("test/method", {})).toThrow(
      "WebSocketJSONRPCClient has been disposed",
    );
  });
});
