import pTimeout from "p-timeout";
import {
  createMessageConnection,
  type Disposable,
  Emitter,
  type Message,
  type MessageConnection,
  type MessageReader,
  type MessageWriter,
  type RAL,
  ReadableStreamMessageReader,
  WriteableStreamMessageWriter,
} from "vscode-jsonrpc";
import type { LSITransport } from "./LSITransport.js";

interface LSWebSocketTransportOptions {
  /** Called when the WebSocket connection is opened */
  onWSOpen?: (e: Event) => void;
  /** Called when the WebSocket connection is closed */
  onWSClose?: (e: CloseEvent) => void;
  /** Called when there is a WebSocket error */
  onWSError?: (error: ErrorEvent) => void;
  /** Called when the language server is considered "healthy" */
  onLSHealthy?: () => void;
  /** The notification path to listen for to consider the LS "healthy" */
  healthyNotificationPath?: string;
  /**
   * The maximum message size in bytes.
   *
   * This is useful because some cloud providers (like Cloudflare on Cloudflare
   * containers) limit the maximum inbound/outbound message size. Since the LSP
   * protocol already offers support for chunking by requiring specifying
   * "Content-Length" headers, we can use this to limit the maximum size of
   * messages we will handle by arbitrarily chunking messages before sending
   * them.
   *
   * @default 512000 (500 KB)
   **/
  maxMessageSize?: number;
}

/**
 * A transport implementation for connecting to a language server over WebSocket.
 *
 * This is unique to many WebSocket transport implementations (for example OpenRPC's
 * https://github.com/open-rpc/client-js/blob/master/src/transports/WebSocketTransport.ts)
 * in that we use the native vscode-jsonrpc library to handle the JSON-RPC protocol
 * messages over the WebSocket connection as if it were just a regular stream.
 * We include the full output of LSP messages including the Content-Length headers
 * and so forth.
 */
export class LSWebSocketTransport implements LSITransport {
  public connection?: WebSocket;
  public uri: string;

  public onWSOpen?: (e: Event) => void;
  public onWSClose?: (e: CloseEvent) => void;
  public onWSError?: (error: ErrorEvent) => void;
  public onLSHealthy?: () => void;
  public healthyNotificationPath?: string;
  public readonly maxMessageSize: number;

  #messageConnection: MessageConnection | null = null;
  #connectingPromise: Promise<void> | null = null;
  #disposed = false;

  #notifyBuffer: [string, unknown][] = [];
  #requestBuffer: [
    string,
    unknown,
    number | undefined,
    (result: unknown) => void,
    (error: unknown) => void,
  ][] = [];

  #errorEmitter = new Emitter<
    [Error, Message | undefined, number | undefined]
  >();
  #notifyEmitter = new Emitter<{ method: string; params: unknown }>();
  #requestEmitter = new Emitter<{ method: string; params: unknown }>();

  constructor(
    uri: string,
    {
      onWSOpen,
      onWSClose,
      onLSHealthy,
      onWSError,
      healthyNotificationPath,
      maxMessageSize = 100 * 1024, // 500 KB
    }: LSWebSocketTransportOptions = {},
  ) {
    this.uri = uri.replace("http", "ws");
    this.onLSHealthy = onLSHealthy;
    this.onWSOpen = onWSOpen;
    this.onWSClose = onWSClose;
    this.onWSError = onWSError;
    this.healthyNotificationPath = healthyNotificationPath;
    this.maxMessageSize = maxMessageSize;
  }

  async sendRequest(
    method: string,
    params?: unknown,
    timeout?: number,
  ): Promise<unknown> {
    this.#errorIfDisposed();

    if (this.#messageConnection) {
      const promise = this.#messageConnection.sendRequest(method, params);
      return timeout ? pTimeout(promise, { milliseconds: timeout }) : promise;
    }
    return new Promise((resolve, reject) => {
      this.#requestBuffer.push([method, params, timeout, resolve, reject]);
    });
  }

  public onRequest(handler: (method: string, params: unknown) => unknown) {
    this.#errorIfDisposed();
    return this.#requestEmitter.event(({ method, params }) =>
      handler(method, params),
    ).dispose;
  }

  public sendNotification(method: string, params?: unknown): void {
    this.#errorIfDisposed();

    if (this.#messageConnection) {
      this.#messageConnection.sendNotification(method, params);
    } else {
      this.#notifyBuffer.push([method, params]);
    }
  }

  public onNotification(handler: (method: string, params: unknown) => void) {
    this.#errorIfDisposed();
    return this.#notifyEmitter.event(({ method, params }) =>
      handler(method, params),
    ).dispose;
  }

  public onError(handler: (error: unknown) => void) {
    this.#errorIfDisposed();
    return this.#errorEmitter.event(handler).dispose;
  }

  public dispose(): void {
    this.connection?.close(1000, "Transport disposed");
    this.#disposed = true;
    this.#errorEmitter.dispose();
    this.#notifyEmitter.dispose();
    this.#requestEmitter.dispose();
  }

  public close(): void {
    // Impl for LSITransport.close
    this.dispose();
  }

  public connected(): boolean {
    return this.connection?.readyState === WebSocket.OPEN;
  }

  public connect(): Promise<void> {
    this.#errorIfDisposed();

    if (this.#connectingPromise) {
      return this.#connectingPromise;
    }

    if (this.connected()) {
      return Promise.resolve();
    }

    this.connection = new WebSocket(this.uri);

    this.#connectingPromise = new Promise<void>((resolve, reject) => {
      const onOpenCb = (e: Event) => {
        this.#errorIfDisposed();

        this.connection?.removeEventListener("open", onOpenCb);
        this.connection?.removeEventListener("error", onErrorCb);

        this.#setupMessageConnection();
        this.onWSOpen?.(e);
        this.#connectingPromise = null;
        resolve();
      };
      this.connection?.addEventListener("open", onOpenCb);

      const onCloseCb = (e: CloseEvent) => {
        this.#errorIfDisposed();

        try {
          this.connection?.removeEventListener("close", onCloseCb);
          this.#messageConnection?.dispose();
          this.#messageConnection = null;
          this.onWSClose?.(e);
        } finally {
          this.dispose();
        }
      };
      this.connection?.addEventListener("close", onCloseCb);

      const onErrorCb = ((error: ErrorEvent) => {
        this.#errorIfDisposed();

        this.connection?.removeEventListener("open", onOpenCb);
        this.connection?.removeEventListener("error", onErrorCb);
        this.onWSError?.(error);
        this.#connectingPromise = null;
        reject(error);
      }) as EventListener;
      this.connection?.addEventListener("error", onErrorCb);
    });

    return this.#connectingPromise;
  }

  #errorIfDisposed(): void {
    if (this.#disposed) {
      throw new WebSocketJSONRPCClientDisposedError();
    }
  }

  #setupMessageConnection(): void {
    if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
      return;
    }

    const { reader, writer } = createWebSocketConnection(
      this.connection,
      this.maxMessageSize,
    );
    this.#messageConnection = createMessageConnection(reader, writer);

    this.#messageConnection.onNotification((method, params) => {
      if (
        this.healthyNotificationPath &&
        method === this.healthyNotificationPath
      ) {
        this.onLSHealthy?.();
      }

      this.#notifyEmitter.fire({ method, params });
    });

    this.#messageConnection.onError((error) => {
      this.#errorEmitter.fire(error);
    });

    this.#messageConnection.onRequest((method, params) => {
      this.#requestEmitter.fire({ method, params });
    });

    this.#messageConnection.listen();

    for (const [method, params] of this.#notifyBuffer) {
      this.#messageConnection.sendNotification(method, params);
    }
    this.#notifyBuffer = [];

    for (const [method, params, timeout, resolve, reject] of this
      .#requestBuffer) {
      try {
        const promise = this.#messageConnection.sendRequest(method, params);
        const finalPromise = timeout
          ? pTimeout(promise, { milliseconds: timeout })
          : promise;
        finalPromise.then(resolve).catch(reject);
      } catch (error) {
        reject(error);
      }
    }
    this.#requestBuffer = [];
  }
}

class WebSocketJSONRPCClientDisposedError extends Error {
  constructor() {
    super("WebSocketJSONRPCClient has been disposed");
    this.name = "WebSocketJSONRPCClientDisposedError";
  }
}

class WebSocketWritableStream implements RAL.WritableStream {
  #socket: WebSocket;
  #errorEmitter = new Emitter<Error>();
  #closeEmitter = new Emitter<void>();
  #pendingContentLength: number | null = null;
  #pendingBuffer: Uint8Array[] = [];
  #supportedEncodings: string[] = ["utf-8", "utf8", "ascii"];
  #chunkSize: number;

  constructor(socket: WebSocket, chunkSize: number) {
    this.#chunkSize = chunkSize;
    this.#socket = socket;
    this.#socket.binaryType = "arraybuffer";
    this.#socket.addEventListener("error", (event) => {
      this.#errorEmitter.fire(new Error(`WebSocket error: ${event}`));
    });
    this.#socket.addEventListener("close", () => {
      this.#closeEmitter.fire(undefined);
    });
  }

  async write(data: string | Uint8Array, encoding = "utf-8"): Promise<void> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    let uint8Data: Uint8Array;
    if (typeof data === "string") {
      if (
        encoding &&
        !this.#supportedEncodings.some((enc) => enc === encoding)
      ) {
        throw new Error(`Unsupported encoding: ${encoding}`);
      }
      uint8Data = new TextEncoder().encode(data);
    } else {
      uint8Data = new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
    }

    // Check if this is a Content-Length header. If we receive one, then buffer and don't send
    // until we have the full content length worth of body. Note that this is somewhat coupled
    // with the way the MessageWriter that vscode-jsonrpc works: it writes two messages every
    // time it sends a message: the Content-Length header and the actual message body. Ideally
    // we could handle fragmented headers, etc.
    const dataStr = new TextDecoder().decode(uint8Data);
    const contentLengthMatch = dataStr.match(/^Content-Length:\s*(\d+)\s*$/i);

    // TODO: technically we could receive content-length in fragments, but we
    // know the underlying library does not do that
    if (contentLengthMatch?.[1]) {
      this.#pendingContentLength = Number.parseInt(contentLengthMatch[1], 10);
      this.#pendingBuffer = [uint8Data];
      return;
    }

    // If we have a pending content length, this should be the message body
    if (this.#pendingContentLength !== null) {
      this.#pendingBuffer.push(uint8Data);

      // Combine all pending data and send as one frame
      const totalLength = this.#pendingBuffer.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      );
      const combinedData = new Uint8Array(totalLength);
      let offset = 0;

      for (const chunk of this.#pendingBuffer) {
        combinedData.set(chunk, offset);
        offset += chunk.length;
      }

      // Chunk after we've loaded up the full content length header + body Uint8Array
      for (const chunk of chunkByteArray(combinedData, this.#chunkSize)) {
        this.#socket.send(chunk.buffer);
      }

      // Reset state
      this.#pendingContentLength = null;
      this.#pendingBuffer = [];
    } else {
      // Send normally if no pending content length
      for (const chunk of chunkByteArray(uint8Data, this.#chunkSize)) {
        this.#socket.send(chunk.buffer);
      }
    }
  }

  public end(): void {
    this.#socket.close();
  }

  public onError(callback: (error: Error) => void): Disposable {
    return this.#errorEmitter.event(callback);
  }

  public onClose(callback: () => void): Disposable {
    return this.#closeEmitter.event(callback);
  }

  public onEnd(callback: () => void): Disposable {
    return this.#closeEmitter.event(callback);
  }
}

class WebSocketReadableStream implements RAL.ReadableStream {
  #dataEmitter = new Emitter<Uint8Array>();
  #errorEmitter = new Emitter<Error>();
  #closeEmitter = new Emitter<void>();

  constructor(socket: WebSocket) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      try {
        let data: Uint8Array;
        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else if (typeof event.data === "string") {
          data = new TextEncoder().encode(event.data);
        } else {
          throw new Error(
            `Unsupported message data format: ${typeof event.data}`,
          );
        }
        this.#dataEmitter.fire(data);
      } catch (e) {
        this.#errorEmitter.fire(e as Error);
      }
    });

    socket.addEventListener("error", (event) => {
      this.#errorEmitter.fire(new Error(`WebSocket error: ${event}`));
    });

    socket.addEventListener("close", () => {
      this.#closeEmitter.fire(undefined);
    });
  }

  public onData(callback: (data: Uint8Array) => void): Disposable {
    return this.#dataEmitter.event(callback);
  }

  public onError(callback: (error: Error) => void): Disposable {
    return this.#errorEmitter.event(callback);
  }

  public onClose(callback: () => void): Disposable {
    return this.#closeEmitter.event(callback);
  }

  public onEnd(callback: () => void): Disposable {
    return this.#closeEmitter.event(callback);
  }
}

function createWebSocketConnection(
  socket: WebSocket,
  chunkSize: number,
): {
  reader: MessageReader;
  writer: MessageWriter;
} {
  const readableStream = new WebSocketReadableStream(socket);
  const reader = new ReadableStreamMessageReader(readableStream);

  const writerStream = new WebSocketWritableStream(socket, chunkSize);
  const writer = new WriteableStreamMessageWriter(writerStream);

  return { reader, writer };
}

// copied from vtlsp/lsp-server/src/lib/lsp/WSStream.ts
function* chunkByteArray(
  byteArray: Uint8Array,
  chunkSize: number,
): Generator<Uint8Array> {
  const totalSize = byteArray.byteLength;
  for (let i = 0; i < totalSize; i += chunkSize) {
    yield byteArray.slice(i, Math.min(totalSize, i + chunkSize));
  }
}
