import { chunkByteArray, createWebSocketStreams } from "./WSStream.ts";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import * as fs from "node:fs";
import { file } from "zod/v4";

describe("chunkByteArray", () => {
  it("provides evenly divisible chunks", () => {
    // Create a test array [0, 1, 2, 3, 4, 5]
    const testArray = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const chunkSize = 2;

    const chunks = Array.from(chunkByteArray(testArray, chunkSize));

    // Should result in 3 chunks: [0,1], [2,3], [4,5]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual(new Uint8Array([0, 1]));
    expect(chunks[1]).toEqual(new Uint8Array([2, 3]));
    expect(chunks[2]).toEqual(new Uint8Array([4, 5]));
  });

  it("can handle non-evenly divisible chunks", () => {
    // Create a test array [0, 1, 2, 3, 4, 5, 6]
    const testArray = new Uint8Array([0, 1, 2, 3, 4, 5, 6]);
    const chunkSize = 3;

    const chunks = Array.from(chunkByteArray(testArray, chunkSize));

    // Should result in 3 chunks: [0,1,2], [3,4,5], [6]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual(new Uint8Array([0, 1, 2]));
    expect(chunks[1]).toEqual(new Uint8Array([3, 4, 5]));
    expect(chunks[2]).toEqual(new Uint8Array([6]));
  });
});

describe("WSStream", () => {
  let ws: WebSocket | undefined;
  let serverWs: WebSocket | undefined;
  let server: Deno.HttpServer | undefined;
  let port = 0;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temporary file for testing
    testFilePath = await Deno.makeTempFile({ prefix: "test-file-", suffix: ".bin" });

    server = Deno.serve({
      port: 0,
      onListen: (info) => {
        port = info.port;
      },
    }, (req) => {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("Expected WebSocket connection", { status: 426 });
      }

      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.addEventListener("message", (event) => {
        // Echo messages back to client for testing
        socket.send(event.data);
      });

      serverWs = socket;

      return response;
    });

    // Create WebSocket client connection
    ws = new WebSocket(`ws://localhost:${port}`);

    // Wait for connection to open
    await new Promise<void>((resolve, reject) => {
      ws!.addEventListener("open", () => resolve());
      ws!.addEventListener("error", (error) => reject(error));
    });
  });

  afterEach(async () => {
    if (ws) {
      ws.close();
      ws = undefined;
    }

    if (server) {
      await server.shutdown();
      server = undefined;
    }

    if (testFilePath) {
      try {
        await Deno.remove(testFilePath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        else throw error;
      }
    }
  });

  it("should be connected", () => {
    expect(ws!.readyState).toBe(WebSocket.OPEN);
  });

  it("should send and receive messages", async () => {
    const { writable } = createWebSocketStreams(ws!);
    const messageToSend = "Hello WebSocket!";

    writable.write(new TextEncoder().encode(messageToSend));
    writable.end();

    const messagePromise = new Promise<void>((resolve, reject) => {
      ws!.addEventListener("message", (event) => {
        try {
          const message = new TextDecoder().decode(event.data as Uint8Array);
          expect(message).toBe(messageToSend);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });

      ws!.addEventListener("error", (error) => {
        reject(error);
      }, { once: true });

      ws!.addEventListener("close", () => {
        reject(new Error("WebSocket closed unexpectedly"));
      }, { once: true });
    });

    await messagePromise;
  });

  it("should be able to use a file stream source", async () => {
    const { writable } = createWebSocketStreams(ws!);

    const fileSizeInBytes = 1024 * 1024; // 1 MB
    const data = new Uint8Array(fileSizeInBytes);
    for (let i = 0; i < fileSizeInBytes; i++) {
      data[i] = i % 256;
    }
    await Deno.writeFile(testFilePath, data);

    const fileStream = fs.createReadStream(testFilePath, { highWaterMark: 1024 * 64 });

    fileStream.pipe(writable);

    await new Promise<void>((resolve, reject) => {
      writable.on("finish", () => {
        fs.unlink(testFilePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      writable.on("error", (error) => {
        reject(error);
      });
    });
  });

  it("should be able to use a file stream destination", async () => {
    const fileSizeInBytes = 209715; // 0.2 MB
    const data = new Uint8Array(fileSizeInBytes);
    for (let i = 0; i < fileSizeInBytes; i++) {
      data[i] = i % 256;
    }
    await Deno.writeFile(testFilePath, data);

    const fileStream = fs.createReadStream(testFilePath, { highWaterMark: 1024 * 64 });

    const { readable: clientReadable } = createWebSocketStreams(ws!);
    const { writable: serverWritable } = createWebSocketStreams(serverWs!);

    const dataPromise = new Promise<void>((resolve, reject) => {
      const receivedChunks: Uint8Array[] = [];

      clientReadable.on("data", (chunk) => {
        receivedChunks.push(new Uint8Array(chunk));
      });

      clientReadable.on("end", () => {
        try {
          const concatenatedData = concatUint8Arrays(receivedChunks);
          expect(concatenatedData.length).toBe(fileSizeInBytes);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      clientReadable.on("error", (error) => {
        reject(error);
      });
    });

    // Pipe the file to the server's writable stream and wait for it to complete
    fileStream.pipe(serverWritable);
    fileStream.on("end", () => {
      ws!.close();
    });

    // Add a timeout in it hangs
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Test timed out waiting for data"));
      }, 5000);
      // Make sure to clear the timeout if the test completes normally
      dataPromise.finally(() => clearTimeout(timer));
    });

    // Wait for either the data to complete or the timeout
    await Promise.race([dataPromise, timeoutPromise]);

    // Clean up resources
    fileStream.destroy();
  });
});

function concatUint8Arrays(receivedChunks: Uint8Array<ArrayBufferLike>[]) {
  const totalLength = receivedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of receivedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
