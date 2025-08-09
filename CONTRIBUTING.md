# Overview

This has three parts that live under the "vtlsp" folder:

1. "lsp", which is a wrapper LSP for codemirror. It has a LSPProxy that proxies
   all requests to and from the Deno language server (or any language server).
   It does things like let us inject diagnostics, automatically cache
   dependencies when we see uncached dependency alerts from Deno, etc. We also
   add various custom methods under `/vtlsp` like `reinitFiles`, to make
   book-keeping easier.
2. "server," which is a Websocket server that pipes messages to and from VTLSP.
   [There's a library that does something
   similar](https://www.npmjs.com/package/vscode-ws-jsonrpc), but I had a lot of
   writing-to-disposed-stream issues.
3. "cloudflare," which is the deployment side. We run vtlsp (the LSP proxy) in
   Cloudflare containers. There's some wrangler configuration associated with
   this, and a proxy layer to route requests into the container and to the LSP.
   There is also a auth handshake to ensure each user can only get a single
   container.

`vtlsp` is a combination of a custom
[Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
implementation that wraps the
[Deno Language Server](https://docs.deno.com/runtime/reference/cli/lsp/), called
`vtlsp`, and a websocket transport server that pipes websocket input to stdin of
`vtlsp`, and stdout of `vtlsp` through the websocket, over JSON RPC 2 via
OpenRPC (a websocket RPC javascript library).

Messages that leave the websocket are OpenRPC/JSONRPC and do not contain LSP
protocol content like "Content-Length," but the LSP process does give us LSP
protocol text. To solve this we use
[vscode-jsonrpc](https://www.npmjs.com/package/vscode-jsonrpc), which lets us
bind handlers to notifications and requests and handles parsing stdout of the
LSP.

`vtlsp` and the corresponding server is implemented in pure Deno. We use the
`ws` library to easly turn a Websocket connection into a stream, and pino for
file logging, since standard out for `vtlsp` is reserved for communication with
the Language Server client.

To gain access to logs for debugging, we have the /logs endpoint. The cloudflare
durable object and the LSP **both** expose this endpoint. The durable object
calls the container at /logs and then merges some of its own metadata with the
result. There are various different categories of results. The logs endpoint
returns a result meant to be viewed by a human, like

```json
{
  "LSP Communication": "...",
  "LSP Server Proxy": "...",
  "Tempdir Files": "..."
}
```

So we can show three tabs in the UI with names "LSP Communication", etc.

# Development

To work on the LSP, use `deno task server` to start `vtlsp`, and when running
remix make sure that you have VAL_TOWN_API_KEY set to a real production API key
for some account, and `DENOLS_URL="http://localhost:5002"`.

To work on the Cloudflare, you can use "npm run deploy:dev" to build and deploy
a container/worker/durable object.

We are using Deno typescript for everything here because we don't want to also
have to package node for the container.
