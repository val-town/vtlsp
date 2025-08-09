import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createWebSocketStreams } from "./WSStream.ts";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { BASE_URL } from "~/consts.ts";

describe({
  name: "LSWSServer",
  fn: () => {
    let ws: WebSocket | undefined;

    beforeEach(async () => {
      ws = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?session=${crypto.randomUUID()}`);

      await new Promise<void>((resolve, reject) => {
        ws!.addEventListener("open", () => resolve());
        ws!.addEventListener("error", (error) => reject(error));
      });
    });

    afterEach(async () => {
      if (ws) {
        ws.close();
        await new Promise<void>((resolve) => {
          ws!.addEventListener("close", () => resolve());
        });
        ws = undefined;
      }
    });

    it("is connected", () => {
      expect(ws!.readyState).toBe(WebSocket.OPEN);
    });

    it("should handle an LSP init message", async () => {
      const { readable, writable } = createWebSocketStreams(ws!);

      const reader = new StreamMessageReader(readable);
      const writer = new StreamMessageWriter(writable);
      const connection = createMessageConnection(reader, writer);
      connection.listen();

      try {
        const response = await connection.sendRequest("initialize", {
          processId: Deno.pid,
          rootUri: "file:///home/user/project",
          capabilities: {},
          // deno-lint-ignore no-explicit-any
        }) as any;

        expect(response).toBeDefined();
        expect(response.capabilities).toBeDefined();
      } catch (error) {
        console.error("LSP Initialization Error:", error);
        throw error; // Re-throw the error to fail the test
      } finally {
        connection.dispose();
      }
    });

    it("should handle duplicate LSP init messages, and give the same response", async () => {
      const { readable, writable } = createWebSocketStreams(ws!);

      const reader = new StreamMessageReader(readable);
      const writer = new StreamMessageWriter(writable);
      const connection = createMessageConnection(reader, writer);
      connection.listen();

      const response1 = await connection.sendRequest("initialize", {
        processId: Deno.pid,
        rootUri: "file:///home/user/project",
        capabilities: {},
        // deno-lint-ignore no-explicit-any
      }) as any;

      expect(response1).toBeDefined();
      expect(response1.capabilities).toBeDefined();

      const response2 = await connection.sendRequest("initialize", {
        processId: Deno.pid,
        rootUri: "file:///home/user/project",
        capabilities: {},
        // deno-lint-ignore no-explicit-any
      }) as any;

      expect(response2).toBeDefined();
      expect(response2.capabilities).toBeDefined();

      expect(response1).toEqual(response2);
    });

    it("should handle two requests for two different connections for the same session", async () => {
      const { readable, writable } = createWebSocketStreams(ws!);

      const reader = new StreamMessageReader(readable);
      const writer = new StreamMessageWriter(writable);
      const connection = createMessageConnection(reader, writer);
      connection.listen();

      // Track messages received by each connection
      const connection1Messages: string[] = [];
      const connection2Messages: string[] = [];

      // Listen to raw WebSocket messages for connection 1
      ws!.addEventListener("message", (event) => {
        const message = event.data;
        const messageStr = new TextDecoder().decode(message);
        connection1Messages.push(messageStr);
      });

      await connection.sendRequest("initialize", {
        processId: Deno.pid,
        rootUri: "file:///home/user/project",
        capabilities: {},
        // deno-lint-ignore no-explicit-any
      }) as any;

      const ws2 = new WebSocket(
        `${BASE_URL.replace("http", "ws")}/ws?session=${ws!.url.split("session=")[1]}`,
      );
      await new Promise<void>((resolve, reject) => {
        ws2.addEventListener("open", () => resolve());
        ws2.addEventListener("error", (error) => reject(error));
      });

      ws2.addEventListener("message", (event) => {
        const message = event.data;
        const messageStr = new TextDecoder().decode(message);
        connection2Messages.push(messageStr);
      });

      const { readable: readable2, writable: writable2 } = createWebSocketStreams(ws2);
      const reader2 = new StreamMessageReader(readable2);
      const writer2 = new StreamMessageWriter(writable2);
      const connection2 = createMessageConnection(reader2, writer2);
      connection2.listen();

      await connection2.sendRequest("vtlsp/ping", {});
      await connection2.sendRequest("initialize", {
        processId: Deno.pid,
        rootUri: "file:///home/user/project",
        capabilities: {},
        // deno-lint-ignore no-explicit-any
      }) as any;

      expect(connection1Messages.length).toBeGreaterThan(0);
      expect(connection2Messages.length).toBeGreaterThan(0);

      // Check that messages don't cross between connections
      const connection1Ids = connection1Messages.map((msg) => {
        const match = msg.match(/"id":(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean).map(Number);

      const connection2Ids = connection2Messages.map((msg) => {
        const match = msg.match(/"id":(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean).map(Number);

      // We should expect that connection 1 gets a response with id 0 and id 1, and connection 2 gets a response with just id 0
      expect(connection1Ids).toContain(0);
      expect(connection1Ids).not.toContain(1);
      expect(connection2Ids).toContain(0);
      expect(connection2Ids).toContain(1);

      ws2.close();
      connection2.dispose();
    });

    it("should handle many simultaneous connections and allow new connections after disconnect", async () => {
      const sessionId = ws!.url.split("session=")[1];
      const connections: WebSocket[] = [];

      for (let i = 0; i < 8; i++) {
        const newWs = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?session=${sessionId}`);
        await new Promise<void>((resolve, reject) => {
          newWs.addEventListener("open", () => resolve());
          newWs.addEventListener("error", (error) => reject(error));
        });
        connections.push(newWs);
      }

      for (const conn of connections) {
        expect(conn.readyState).toBe(WebSocket.OPEN);
      }

      await Promise.allSettled(connections
        .map((conn) => {
          return new Promise<void>((resolve) => {
            conn.addEventListener("close", () => resolve());
            conn.close();
          });
        }));

      const newWs = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?session=${sessionId}`);
      await new Promise<void>((resolve, reject) => {
        newWs.addEventListener("open", () => resolve());
        newWs.addEventListener("error", (error) => reject(error));
      });

      const { readable, writable } = createWebSocketStreams(newWs);
      const reader = new StreamMessageReader(readable);
      const writer = new StreamMessageWriter(writable);
      const connection = createMessageConnection(reader, writer);
      connection.listen();

      try {
        const response = await connection.sendRequest("initialize", {
          processId: Deno.pid,
          rootUri: "file:///home/user/project",
          capabilities: {},
          // deno-lint-ignore no-explicit-any
        }) as any;

        expect(response).toBeDefined();
        expect(response.capabilities).toBeDefined();
      } finally {
        connection.dispose();
        newWs.close();
      }
    });
  },
  sanitizeOps: false,
});
