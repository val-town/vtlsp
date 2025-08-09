This is the deployment part of our custom "VTLSP". "VTLSP" runs in Cloudflare
containers. Cloudflare containers are Cloudflare workers that can proxy to
"Durable Objects," which are snippets of JavaScript that have persistent state,
which now also have the ability to "own" a container that they can then further
proxy to.

The general flow is:

- An HTTP request hits the Worker (the worker is a stateless "JavaScript
  runner"):
  - If the request is a POST to /lsp/auth, and includes a API key via the
    `x-val-town-api-key` header, we respond with a Set-Cookie that includes a
    signed cookie that includes their user ID. They only way they can get a
    signed cookie with their user ID is by providing a valid access token, which
    only they have access to.
  - Then they GET /lsp/ws, now with the cookie, we unwrap the cookie. If we
    signed it we can trust that this user with their user ID should be able to
    access a container. If it is still valid, then we proxy to a container at
    ws://container/ws.
- A WS request hits the container:
  - The client makes an LSPClient in the browser, gets a 24 hour read only API
    key, and makes an init LSP request.
  - Deno gets spawned with `DENO_AUTH_TOKENS` using the apiKey in the init LSP
    request.

The reason we do this auth handshake is that

- It's expensive(er) to spawn a durable object, so we rather pre-validate them
  on the worker.
- We want to validate them once and not have to make additional API calls to Val
  Town, and a signed cookie allows us to do that.
- And we don't want to put API keys in query params if we can help it.

Noting that:

- Users never put an API key directly into a query param, and websockets can't
  use headers (they can, but the APIs using them don't allow it).
- We want to use the user id as the shard ID, but need to make sure users can
  only create API keys for themself.
- WebSockets support custom headers but the WebAPI doesn't actually let you set
  them. But cookies make their way through!

For the worker we are using [Hono](https://hono.dev/) for routing. A lot of
people like [Itty Router](https://github.com/kwhitley/itty-router), but Hono has
nice utilities for things like signing cookies.

# Notes

- We are using the
  [beta Container wrapper class](https://github.com/mikenomitch/containers).
  This wraps the `DurableObject` class. It has a lot of niceities for things
  like keeping the Durable Object awake with alarms for some amount of time
  after the last WebSocket connection (by default it would instantly die).
  Because of a Cloudflare bug, in the Hono router you can only use methods that
  DurableObject has, even though it's a Container, like `fetch`. The default
  `fetch` proxies to the container by basically calling `containerFetch`. You
  CAN override methods in our custom Container.
- Should we be using "new_classes" or
  ["new_sqlite_classes"](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
  in the wrangler.json?
- You may do a `npm run deploy` and not see any difference in the container. You
  need to use a different shard ID to start getting instances of the new
  container. One easy way to do this is to prefix/suffix shard IDs (at least
  temporarily)
