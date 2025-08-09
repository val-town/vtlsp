import { after, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { BASE_URL } from "~/consts.ts";

describe("format endpoint", () => {
  it("should format TypeScript code", async () => {
    const unformattedCode = `
    function hello(    name:string){
    return "Hello, "+name+"!";
    }
    `;

    const res = await fetch(`${BASE_URL}/format`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: unformattedCode,
        path: "test.ts",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.text();
    expect(data).toContain("function hello(name: string)");
    expect(data).toContain('return "Hello, " + name + "!";');
  });

  it("should format TypeScript code with custom config (no semicolons)", async () => {
    const unformattedCode = `
      function hello(    name:string){
      return "Hello, "+name+";";
      console.log("Done");}
      `;

    const res = await fetch(`${BASE_URL}/format`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: unformattedCode,
        path: "test.ts",
        config: {
          semiColons: false,
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.text();

    expect(data).toContain("function hello(name: string)");
    expect(data).toContain('return "Hello, " + name + ";"');
    expect(data).not.toContain('return "Hello, " + name + ";";\n');
    expect(data).not.toContain('console.log("Done");\n');
  });
});

describe({
  name: "WebSocket endpoint",
  fn: () => {
    let ws: WebSocket | null = null;
    const wsId1 = crypto.randomUUID();
    const wsId2 = crypto.randomUUID();

    after(() => {
      ws?.close();
    });

    it("should handle WebSocket connections at /ws", async () => {
      ws = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?session=${wsId1}`);

      let newWs: WebSocket | null = null;

      const timeout = setTimeout(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          throw new Error(`WebSocket connection didn't close in time. State: ${ws.readyState}`);
        } else {
          ws?.close();
        }
      }, 2000);

      await new Promise<void>((resolve, reject) => {
        ws!.addEventListener("close", () => {
          clearTimeout(timeout);
          ws = newWs;
          resolve();
        });
        ws!.addEventListener("error", (error) => reject(error));

        newWs = new WebSocket(`${BASE_URL.replace("http", "ws")}/ws?session=${wsId2}`);
      });
    });

    it("should return 200 OK on /kill and close the WebSocket with 1012", async () => {
      const toBeKilledWebSocketSessionId = crypto.randomUUID();
      const toBeClosedWebSocket = new WebSocket(
        `${BASE_URL.replace("http", "ws")}/ws?session=${toBeKilledWebSocketSessionId}`,
      );
      let closedCode: number | undefined;

      toBeClosedWebSocket.addEventListener("close", (event) => {
        closedCode = event.code;
      });

      await new Promise<void>((resolve, reject) => {
        toBeClosedWebSocket.addEventListener("open", () => resolve());
        toBeClosedWebSocket.addEventListener("error", (error) => reject(error));
      });

      const res = await fetch(`${BASE_URL}/kill`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: toBeKilledWebSocketSessionId }),
      });

      expect(res.status).toBe(200);
      const data = await res.text();
      expect(data).toBe("Session killed successfully");

      // Ensure the WebSocket connection is closed with 1012
      expect(toBeClosedWebSocket.readyState).toBe(WebSocket.CLOSED);
      expect(closedCode).toBe(1012);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
