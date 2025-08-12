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
import { logger } from "~/logger.ts";

interface WebSocketStreamOptions {
  chunkSize?: number;
}

class WebSocketReadableStream extends Readable {
  #websocket: WebSocket;
  #listeners: [string, EventListener][] = [];

  constructor(ws: WebSocket) {
    super();
    this.#websocket = ws;
    logger.debug("WebSocketReadableStream initialized");

    const messageHandler = ((event: MessageEvent) => {
      logger.debug("WebSocketReadableStream received message");
      this.push(Buffer.from(event.data));
    }) as EventListener;
    this.#listeners.push(["message", messageHandler]);
    ws.addEventListener("message", messageHandler);

    const errorHandler = (event: Event) => {
      logger.error({ event }, "WebSocketReadableStream received error event");
      this.emit("error", event);
    };
    this.#listeners.push(["error", errorHandler]);
    ws.addEventListener("error", errorHandler);

    const closeHandler = ((event: CloseEvent) => {
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
    }) as EventListener;
    this.#listeners.push(["close", closeHandler]);
    ws.addEventListener("close", closeHandler);
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
    // Clean up event listeners
    for (const [event, listener] of this.#listeners) {
      this.#websocket.removeEventListener(event, listener);
    }

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
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ) {
    logger.debug(
      { bytes: chunk.length },
      "WebSocketWritableStream writing data",
    );

    if (this.#websocket.readyState === WebSocket.OPEN) {
      try {
        // Append the new chunk to the buffer
        this.#appendToBuffer(chunk);

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
      this.#appendToBuffer(chunk);
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
// copy to vtlsp/codemirror-lsp/plugin/transport/websocket/LSWebSocketTransport.ts
// TODO: find a better way to manage shared code. This is deno and vtlsp/codemirror-lsp/** is browser
// (importing "~/logger.ts" breaks this import there since it's only in the deno.json import map)
