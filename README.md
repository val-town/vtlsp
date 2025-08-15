# VTLSP: Val Town's LSP Powered Editor

![Val Town editor demo](https://filedumpthing.val.run/blob/blob_file_1755128319090_output_8.gif)

VTLSP provides a complete solution to running a language server on a server, and stream messages to an editor in your browser.  This is a monorepo of the core components that make this possible, including a codemirror client library, language server WebSocket server, and language server "proxy."

# Background

The language server protocol is a simple JSON-RPC protocol that allows editor clients to communicate with language servers (LS) to get editor features like code completions and diagnostics. This is what powers red squiggles and fancy code action buttons. Usually LSP is done via payloads over standard in and standard out to a language server process running on your computer, typically spawned by your editor. Often editors make it very easy to install language servers, so you don't know you're using one -- VScode extensions for languages generally pack them in.

Running arbitrary language servers directly in the browser is challenging for multiple reasons. You have to compile the language server to webasm if it isn't already in JS/TS, and then once you have it running, you need a client to display and interact with the language server, and manage messages and state updates. To make this easier, this repo provides a way to run language servers as WebSocket servers, and a client library for the Codemirror editor to act as a LSP frontend client.

## [Codemirror LS Client Library](./codemirror-ls/README.md) [(NPM)](https://www.npmjs.com/package/@valtown/codemirror-ls)

Our Codemirror client library provides various extensions to serve as a client to a language server. It propagates code edits to the language server, and displays things like code diagnostics and tooltips.  It uses some extensions from [Codemirror's official client library](https://github.com/codemirror/lsp-client) with modification, and was originally based on [Monaco's client](https://github.com/TypeFox/monaco-languageclient).


## [LS WebSocket server](./ls-ws-server/README.md) [(NPM)](https://www.npmjs.com/package/@valtown/ls-ws-server)

To actually communicate from a browser to a language server, it is most simple to rely messages through a WebSocket server. Our Codemirror Client is intentionally agnostic about the type of transport used, but we provide a reference WebSocket transport in our client library.

Our language server WebSocket server is able to multicast messages to many consumers of the same language server process, so you can connect from multiple browsers, and requests made from a specific session ID (which is a query parameter) will only be responded to to the specific WebSocket connection, but notifications get broadcasted.

Additionally, to run an LSP remotely, some language servers, like the Deno language server, rely on file system events and require physical files on disc to work properly. There are also other language server lifecycle events that are useful to intercept or handle differently in a remote environment, like for example installing packages as the user imports them. We provide an LS proxy to make it easy to automatically transform requests for specific methods with arbitrary middleware.

# [Live Demo (Here)](https://cf-vtlsp-demo.val-town.workers.dev/demo)

![The live demo](https://filedumpthing.val.run/blob/blob_file_1755126264734_output.gif)

We have a full demo of all the components of this repo in [./demo](./demo/README.md), where we deploy a simple React app with Codemirror that connects to the `Deno` language server over a WebSocket connection to a cloudflare container (an easy, ephemeral docker container in the cloud). It runs a WebSocket server for the deno language server with simple language server proxy modifications: Deno requires a `deno.json` in the directory of the language server to activate, and can get buggy if files do not actually exist locally, so the proxy simulates those two things on respective requests.

# Alternatives and Inspiration

This general LSP architecture of having a proxy and relaying messages over a WebSocket"ification" server is partially inspired by Qualified's [lsp-ws-proxy](https://github.com/qualified/lsp-ws-proxy) project. The main difference here is that we make it easy to add additional, arbitrary logic at the LS proxy layer, and we handle chunking WebSocket messages differently.

For our Codemirror language server, we are using components derived or reused from Marijn's official Codemirror [language server client](https://github.com/FurqanSoftware/codemirror-languageserver), like the signature help extension. Initially, we started with a fork of [Monaco](https://github.com/TypeFox/monaco-languageclient)'s Codemirror client implementation.

## Try it out!

To try it out, copy out the [demo](./demo/), open the [`wrangler.json`](./demo/wrangler.jsonc), replace the `accountId` with your cloudflare account ID, and then run `npx wrangler@latest deploy`!