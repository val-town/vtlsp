# VTLSP Demo Deployment

This is a simple demo of all the components of this repo: A language server WebSocket server with a basic proxy to run the Deno language server.

There are two components, the language server client editor, and the WebSocket server.

The client is a React app that uses our codemirror client library, built with Vite, and running as a Cloudflare Worker with an associated [Cloudflare container](https://developers.cloudflare.com/containers/) to actually run the language server.

The server runs as a Cloudflare containers. Cloudflare containers make it very easy to dynamically prevision sandboxed instances to individual users, and because routing is very easy and can be done with arbitrary keys.

In this demo, you'll find:

### Cloudflare Deployment

[A definition for a Container enabled Cloudflare durable object](./deploy/main.ts), that includes an export for a tiny Hono app that proxies to the language server. The Container class is a utility class Cloudflare provides to make it easy to route requests into ephemeral containers. The fetch export is a definition for a Cloudflare worker, which is just a "javascript runner." We arbitrarily in this demo choose to route requests by the `?id=` query parameter, but you could decide to route to unique containers however you want. At Val Town, we choose to route users to containers using users' user ids as the literal ID of the container that we route them to. We also have an associated `wrangler.json` which sets up the necessary "Bindings" to deploy the Cloudflare container.

Since we're already using Cloudflare containers, for simplicity of the demo we also deploy the frontend, a tiny React + Vite app, as a Cloudflare worker. We build the app (with Vite) as a static website, and then specify in the `wrangler.json` to upload the build outputs.

The Deno language server has some quirks when running it in a virtual environment. In some areas it expects physical files to exist on disc. Additionally, it will only "wake up" if there is a `deno.json` in the directory that the process is spawned from. We have a very minimal usage of our `LSProxy` that takes care of these quirks. On Val Town, we also make additional modifications to the language server via the LSProxy, like [custom env variable suggestions](https://filedumpthing.val.run/blob/blob_file_1755106837620_1fd7a65c-4a8d-437d-a0c6-1b61e1ef71da.gif), which is implemented by "mocking" a file that augments Deno.env.get.

For the actual server, we're using the WebSocket server in this repo to host the language server for us. This launches the proxy LSP, and then exposes it to the internet via an HTTP endpoint on a WebSocket server.
