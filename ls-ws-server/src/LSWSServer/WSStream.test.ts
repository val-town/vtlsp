import { chunkByteArray, createWebSocketStreams } from "./WSStream.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  let server: http.Server | undefined;
  let port = 0;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temporary file for testing
    testFilePath = path.join(os.tmpdir(), `test-file-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
    await fs.promises.writeFile(testFilePath, Buffer.alloc(0));

    server = http.createServer();
    
    server.on('upgrade', (request, socket, head) => {
      const key = request.headers['sec-websocket-key'];
      const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        ''
      ].join('\r\n');

      socket.write(responseHeaders);

      // Create server-side WebSocket manually for testing
      const mockServerWs = {
        send: (data: any) => {
          const frame = Buffer.concat([
            Buffer.from([0x81]), // FIN + text frame
            Buffer.from([data.length]),
            Buffer.from(data)
          ]);
          socket.write(frame);
        }
      };
      serverWs = mockServerWs as any;

      socket.on('data', (data) => {
        // Simple WebSocket frame parsing for testing
        if (data.length > 2) {
          const payloadLength = data[1] & 0x7F;
          const maskStart = 2;
          const dataStart = maskStart + 4;
          const mask = data.slice(maskStart, dataStart);
          const payload = data.slice(dataStart, dataStart + payloadLength);
          
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
          }
          
          // Echo back to client
          mockServerWs.send(payload);
        }
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, () => {
        port = (server!.address() as any).port;
        resolve();
      });
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
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    if (testFilePath) {
      try {
        await fs.promises.unlink(testFilePath);
      } catch (error) {
        if ((error as any).code === "ENOENT") return;
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

    writable.write(Buffer.from(messageToSend));
    writable.end();

    const messagePromise = new Promise<void>((resolve, reject) => {
      ws!.addEventListener("message", (event) => {
        try {
          const message = Buffer.isBuffer(event.data) ? event.data.toString() : new TextDecoder().decode(event.data as ArrayBuffer);
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
    const data = Buffer.alloc(fileSizeInBytes);
    for (let i = 0; i < fileSizeInBytes; i++) {
      data[i] = i % 256;
    }
    await fs.promises.writeFile(testFilePath, data);

    const fileStream = fs.createReadStream(testFilePath, { highWaterMark: 1024 * 64 });

    fileStream.pipe(writable);

    await new Promise<void>((resolve, reject) => {
      writable.on("finish", async () => {
        try {
          await fs.promises.unlink(testFilePath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      writable.on("error", (error) => {
        reject(error);
      });
    });
  });

  it("should be able to use a file stream destination", async () => {
    const fileSizeInBytes = 209715; // 0.2 MB
    const data = Buffer.alloc(fileSizeInBytes);
    for (let i = 0; i < fileSizeInBytes; i++) {
      data[i] = i % 256;
    }
    await fs.promises.writeFile(testFilePath, data);

    const fileStream = fs.createReadStream(testFilePath, { highWaterMark: 1024 * 64 });

    const { readable: clientReadable } = createWebSocketStreams(ws!);
    const { writable: serverWritable } = createWebSocketStreams(serverWs!);

    const dataPromise = new Promise<void>((resolve, reject) => {
      const receivedChunks: Buffer[] = [];

      clientReadable.on("data", (chunk) => {
        receivedChunks.push(Buffer.from(chunk));
      });

      clientReadable.on("end", () => {
        try {
          const concatenatedData = Buffer.concat(receivedChunks);
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
