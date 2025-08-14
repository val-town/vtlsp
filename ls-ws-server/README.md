# LS WebSocket Server

This is a WebSocket server for language servers that allows clients (typically code editors) to communicate to a running language server process.

It is meant to be used with your framework of choice, and provides a simple `handleNewWebsocket` handler for when a new connection has been upgraded and should be wired to an LSP.

Here's a simple example set up for the Deno language server:

```typescript
// ls-proxy.ts

import { LSWSServer } from "vtls-server";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const lsWsServer = new LSWSServer({
  lsCommand: "deno", // real LS (we're using deno to run the deno LS)
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

Including a small language server "proxy" server:

```ts
// main.ts

import { LSroxy, utils } from "vtls-server";

const TEMP_DIR = await Deno.makeTempDir({ prefix: "vtlsp-proxy" });

const onExit = async () => await Deno.remove(TEMP_DIR, { recursive: true });
Deno.addSignalListener("SIGINT", onExit);
Deno.addSignalListener("SIGTERM", onExit);

const proxy = new LSroxy({
  name: "lsp-server",
  cwd: TEMP_DIR, // Where the LS gets spawned from
  exec: {
    command: "deno", // proxy LS
    args: ["run", "-A", "./ls-proxy.ts"],
  },
  // Also, you can use procToClientMiddlewares, procToClientHandlers, and clientToProcHandlers
  clientToProcMiddlewares: {
    initialize: async (params) => {
      await Deno.writeTextFile(`${TEMP_DIR}/deno.json`, JSON.stringify({})); // Create a deno.json in the temp dir
      return params;
    },
    "textDocument/publishDiagnostics": async (params) => { // Params are automatically typed! All "official" LSP methods have strong types
      if (params.uri.endsWith(".test.ts")) {
        return {
          ls_proxy_code: "cancel_response" // A "magic" code that makes it so that the message is NOT passed on to the LS
        }
      }
  }
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

proxy.listen(); // Listens by default on standard in / out, and acts as a real LS
```

We're using Deno, but you could just as well write this in Node. To run it, you'd use a command like:

```bash
deno run -A main.ts
```

Or if you want the server to crash if a language server process has a "bad exit" (crash),

```bash
EXIT_ON_LS_BAD_EXIT=1 deno run -A main.ts
```

## Routing to LS processes

Every connection to our WebSocket language server requires a `?session={}`. The session IDs are unique identifiers for a language server process; if you connect to the same session in multiple places you will be "speaking" to the same language server process. As a result of this design, the WebSocket server allows multicasting language server connections. Many clients (for example, tabs) can connect to the same language server process, and when they make requests to the language server (like go to definition), only the requesting connection receives a response for their requests.

There are some additional subtileies here that you may need to think about if you're designing a language server with multiple clients. Some language servers, like the Deno language server, may crash or exhibit weird behavior if clients try to initialize and they are already initialized. Additionally, during the LSP handshake, clients learn information about supported capabilities of the language server. One easy solution to this is to use an LS proxy to "cache" the initialize handshake, so that clients that come in the future will not send additional initialize requests to the language server.

## LS Proxying Server

This library exposes a language server proxy builder, which makes it really easy to automatically transform requests going to or coming out from the language server. With the language server proxy, you can:

Language server processes communicate via JSON-RPC messages - either "requests" or "notifications".  Usually they communicate via inbound messages on standard in and outbound messages on standard out.

Notifications are send and forget. An example of a notification we send to the language server may look like

```json
{ "jsonrpc": "2.0",
  "method": "textDocument/didChange",
  "params": { "textDocument": { "uri": "file:///document.txt", "version": 2 }, "contentChanges": [ { "text": "Hello" } ] }
}
```

Requests get exactly one reply, and look like

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "textDocument/hover",
  "params": { "textDocument": { "uri": "file:///document.txt" }, "position": { "line": 0, "character": 2 } }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "contents": { "kind": "plaintext", "value": "Hover information" }
  }
}
```

With our language server proxy builder, you can

- Intercept notifications that leave the language server, and maybe modify or cancel them, or vice versa.
- Intercept requests that come to the language server, and maybe modify the request parameters, or the response.
- Define custom handlers that override existing ones or implement entirely new language server methods.

And, the result is a new language server that also reads from standard in and writes to standard out, but may transform messages before they get to the process, or the client.