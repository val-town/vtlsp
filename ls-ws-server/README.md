# LS WebSocket Server

This is a WebSocket server for language servers that allows clients (typically code editors) to communicate to a running language server process.

It is meant to be used with your framework of choice, and provides a simple `handleNewWebsocket` handler for when a new connection has been upgraded and should be wired to an LSP.

```typescript
import { LSWSServer } from "vtls-server";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const lsWsServer = new LSWSServer({
  lsCommand: "deno",
  lsArgs: ["lsp", "-q"],
  lsLogPath: Deno.makeTempDirSync({ prefix: "vtlsp-procs" }),
});

const app = new Hono()
  .get("/", zValidator("query", z.object({ session: z.string() })), (c) => {
    const { socket, response } =  Deno.upgradeWebSocket(c.req.raw);
    return lsWsServer.handleNewWebsocket(
      socket,
      c.req.valid("query").session,
    );
  })

Deno.serve({ port: 5002, hostname: "0.0.0.0" }, app.fetch);
```

## Session Based Routing

Every connection to our WebSocket language server requires a `?session={}`. The session IDs are unique identifiers for a language server process; if you connect to the same session in multiple places you will be "speaking" to the same language server process. As a result of this design, the WebSocket server allows multicasting language server connections. Many clients (for example, tabs) can connect to the same language server process, and when they make requests to the language server (like go to definition), only the requesting connection receives a response for their requests.

There are some additional subtileies here that you may need to think about if you're designing a language server with multiple clients. Some language servers, like the Deno language server, may crash or exhibit weird behavior if clients try to initialize and they are already initialized. Additionally, during the LSP handshake, clients learn information about supported capabilities of the language server. One easy solution to this is to use an LS proxy to "cache" the initialize handshake, so that clients that come in the future will not send additional initialize requests to the language server.

## Inputs and Outputs

Our LSP WebSocket server supports 

## Crash reporting

When the underlying language server crashes or exists an "error report" is printed to standard error.

If the underlying language server has a "bad" exit, and `EXIT_ON_LS_BAD_EXIT=1` is set (as an environment variable), then the entire WebSocket server will shut down.

# LS Proxy

This library also contains a Language server proxy, which is a proxy builder for language server processes.

## Background

Language server processes communicate via JSON-RPC messages - either "requests" or "notifications".

Notifications are send and forget. An example of a notification we send to the language server may look like

```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/didChange",
  "params": {
    "textDocument": {
      "uri": "file:///document.txt",
      "version": 2
    },
    "contentChanges": [
      {
        "text": "Hello"
      }
    ]
  }
}
```

Requests get exactly one reply, and look like

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "textDocument/hover",
  "params": {
    "textDocument": {
      "uri": "file:///document.txt"
    },
    "position": {
      "line": 0,
      "character": 2
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "contents": {
      "kind": "plaintext",
      "value": "Hover information"
    }
  }
}
```

Our language server proxy makes it easy to automatically add _middleware_ or _handler_ functions that act on inbound or outbound language server requests.

## LSProxy

```ts
import { LSPProxy, utils } from "vtls-server";

const TEMP_DIR = await Deno.makeTempDir({ prefix: "vtlsp-proxy" });

const onExit = async () => await Deno.remove(TEMP_DIR, { recursive: true });
Deno.addSignalListener("SIGINT", onExit);
Deno.addSignalListener("SIGTERM", onExit);

const proxy = new LSPProxy({
  name: "lsp-server",
  tempDir: TEMP_DIR,
  exec: {
    command: "deno",
    args: ["lsp", "-q"],
  },
  clientToProcMiddlewares: {
    initialize: async (params) => {
      await Deno.writeTextFile(`${TEMP_DIR}/deno.json`, JSON.stringify({})); // Create a deno.json in the temp dir
      return params;
    },
  },
  uriConverters: {
    fromProcUri: (uriString: string) => {
      // Takes URIs like /tmp/fije3189rj/buzz/foo.ts and makes it /buzz/foo.ts
      return utils.tempDirUriToVirtualUri(uriString, TEMP_DIR);
    },
    toProcUri: (uriString: string) => {
      // Takes URIs like /bar/foo.ts and makes it /tmp/fije3189rj/foo.ts
      return utils.virtualUriToTempDirUri(uriString, TEMP_DIR)!;
    },
  },
});

proxy.listen();
```

Canceling Responses Early

In a middleware, you can choose to totally skip forwarding the message you are proxying to the process by returning a special "cancel response code" like so

```ts
procToClientMiddlewares: {
  "textDocument/publishDiagnostics": async (params) => {
    if (params.uri.endsWith(".test.ts")) {
      return {
        ls_proxy_code: "cancel_response" // A "magic" code that makes it so that the message is NOT passed on to the LSP
      }
    }
  }
}
```
