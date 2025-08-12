/**
 * Node.js stream implementations for the browser WebSocket class.
 *
 * In most cases use the createWebSocketStreams function to create
 * readable and writable streams for a WebSocket connection.
 *
 * The Writable stream will automatically chunk data into smaller
 * pieces to avoid exceeding WebSocket message size limits that some providers (like Cloudflare)
 * impose.
 */

import { Readable, Writable } from "node:stream";
import { Buffer } from "node:buffer";
import { logger } from "~/logger.js";
import {
  WebSocket,
  type CloseEvent,
  type MessageEvent,
  type ErrorEvent,
} from "isomorphic-ws";

interface WebSocketStreamOptions {
  chunkSize?: number;
}

class WebSocketReadableStream extends Readable {
  #cleanupCbs: (() => void)[] = [];

  constructor(ws: WebSocket) {
    super();
    logger.debug("WebSocketReadableStream initialized");

    const messageHandler = (event: MessageEvent) => {
      logger.debug("WebSocketReadableStream received message");

      // Handle different data types that WebSocket can receive
      let buffer: Buffer;
      if (event.data instanceof ArrayBuffer) {
        buffer = Buffer.from(event.data);
      } else if (typeof event.data === "string") {
        buffer = Buffer.from(event.data, "utf8");
      } else if (event.data instanceof Uint8Array) {
        buffer = Buffer.from(event.data);
      } else {
        buffer = Buffer.from(String(event.data), "utf8");
      }

      this.push(buffer);
    };
    ws.addEventListener("message", messageHandler);
    this.#cleanupCbs.push(() =>
      ws.removeEventListener("message", messageHandler),
    );

    const errorHandler = (event: ErrorEvent) => {
      logger.error({ event }, "WebSocketReadableStream received error event");
      this.emit("error", event);
    };
    ws.addEventListener("error", errorHandler);
    this.#cleanupCbs.push(() => ws.removeEventListener("error", errorHandler));

    const closeHandler = (event: CloseEvent) => {
      logger.info(
        {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        },
        "WebSocketReadableStream received close event",
      );
      // stream.push(null) signals EOF
      this.push(null);
    };
    ws.addEventListener("close", closeHandler);
    this.#cleanupCbs.push(() => ws.removeEventListener("close", closeHandler));
  }

  override _read() {
    // Reading is driven by WebSocket events, so no action needed here
    logger.trace("WebSocketReadableStream: _read called");
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    logger.debug(
      { error: error?.message },
      "WebSocketReadableStream is getting destroyed",
    );

    this.#cleanupCbs.forEach((cb) => cb());

    callback(error);
  }
}

/**
 * A Writable stream that sends data to a WebSocket
 */
class WebSocketWritableStream extends Writable {
  #websocket: WebSocket;
  #chunkSize: number;
  #buffer: Buffer = Buffer.alloc(0);

  constructor(
    ws: WebSocket,
    { chunkSize = 100 * 1024 }: WebSocketStreamOptions = {},
  ) {
    super();
    this.#websocket = ws;
    this.#chunkSize = chunkSize;

    this.#websocket.addEventListener("close", (event: CloseEvent) => {
      logger.info(
        {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        },
        "WebSocketWritableStream received close event",
      );
    });

    logger.debug({ chunkSize }, "WebSocketWritableStream initialized");
  }

  override _write(
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary data
    chunk: any,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    logger.debug(
      { bytes: buffer.length },
      "WebSocketWritableStream writing data",
    );

    if (this.#websocket.readyState === WebSocket.OPEN) {
      try {
        // Append the new chunk to the buffer
        this.#appendToBuffer(buffer);

        // Send the entire buffer
        this.#sendWithChunking(this.#buffer);

        // Clear the buffer after sending
        this.#clearBuffer();
        callback();
      } catch (err) {
        logger.error(
          { error: err },
          "WebSocketWritableStream: error during write",
        );
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      logger.debug(
        { readyState: this.#websocket.readyState },
        "WebSocketWritableStream socket not open, buffering data",
      );
      // If WebSocket is not open, buffer the data
      this.#appendToBuffer(buffer);
      callback();
    }
  }

  #appendToBuffer(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    logger.debug(
      {
        newBufferSize: this.#buffer.length,
        addedBytes: chunk.length,
      },
      "WebSocketWritableStream buffer updated",
    );
  }

  #clearBuffer() {
    logger.debug("WebSocketWritableStream clearing buffer");
    this.#buffer = Buffer.alloc(0);
  }

  override _final(callback: (error?: Error | null) => void) {
    logger.debug("WebSocketWritableStream: finalizing");

    // Send any remaining buffered data
    if (this.#buffer.length > 0) {
      try {
        this.#sendWithChunking(this.#buffer);
        this.#clearBuffer();
      } catch (err) {
        return callback(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Don't close the WebSocket - let the application manage the WebSocket lifecycle
    logger.debug("WebSocketWritableStream finalized without closing WebSocket");
    callback();
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    logger.debug(
      { error: error?.message },
      "WebSocketWritableStream is getting destroyed",
    );
    // Let application handle WebSocket close
    callback(error);
  }

  #sendWithChunking(data: Buffer) {
    logger.debug(
      { totalBytes: data.length, chunkSize: this.#chunkSize },
      "WebSocketWritableStream sending data with chunking",
    );

    for (const chunk of chunkByteArray(data, this.#chunkSize)) {
      this.#websocket.send(chunk);
    }
  }
}

/**
 * Creates stream interfaces for a WebSocket
 *
 * @param ws The WebSocket instance to wrap with streams
 * @returns Readable and writable stream interfaces
 */
export function createWebSocketStreams(
  ws: WebSocket,
  { chunkSize = 900 * 1024 }: WebSocketStreamOptions = {},
) {
  logger.info({ chunkSize }, "Creating WebSocket streams");
  ws.binaryType = "arraybuffer";

  const readable = new WebSocketReadableStream(ws);
  const writable = new WebSocketWritableStream(ws, { chunkSize });

  return { readable, writable };
}

export function* chunkByteArray(
  byteArray: Uint8Array,
  chunkSize: number,
): Generator<Uint8Array> {
  const totalSize = byteArray.byteLength;

  for (let i = 0; i < totalSize; i += chunkSize) {
    const chunkEnd = Math.min(totalSize, i + chunkSize);
    yield byteArray.slice(i, chunkEnd);
  }
}
