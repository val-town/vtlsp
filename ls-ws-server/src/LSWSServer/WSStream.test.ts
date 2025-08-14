import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WSS from "vitest-websocket-mock";
import { chunkByteArray, createWebSocketStreams } from "./WSStream.js";

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
  let server: WSS;
  let client: WebSocket;

  beforeEach(async () => {
    server = new WSS("ws://localhost:1234");
    client = new WebSocket("ws://localhost:1234");
    await new Promise((res) => {
      client.onopen = res;
    });
  });

  afterEach(() => {
    WSS.clean();
  });

  it("can ping and pong", async () => {
    const { readable, writable } = createWebSocketStreams(client);

    readable.on("data", (data) => {
      expect(data).toEqual("pong");
    });

    server.on("message", (client) => {
      expect(client).toEqual("ping");
      server.send("pong");
    });

    const expectPromise = expect(server).toReceiveMessage(Buffer.from("ping"));
    writable.write("ping");
    await expectPromise;

    await server.connected;
  });
});
