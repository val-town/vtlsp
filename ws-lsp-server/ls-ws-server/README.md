This is a Websocket and HTTP server that runs inside the Cloudflare container that can connect
inbound Websocket connections to LSP processes. It can manage multiple connections at once. It also
exposes a /format HTTP endpoint to format code with `deno fmt`.

The connection logic for the WebSocket is a little bit tricky:

- When you connect to the server from the outside world, you hit /lsp/ws?. In the Worker routing,
  /lsp/* takes you to the * in the container. So for this server, you're hitting /ws?...
- When you hit /ws?.., you use /ws?session={sessionId}. If you don't include a {sessionId} then one
  is chosen for you. This uuid is important, because it is a unique identifier to the LSP process
  that you are connecting to.
- When you spawn the server, you can choose `--max-procs`. If you connect to a new session and the
  current number of procs running on the server is greater than the max allowed, then sessions get
  closed in order of oldest to newest until there is room to spawn a new one. Then the new session
  is created, a process is spawned, and you are connected.
- When you establish a WebSocket connection to an LSP process with some id {sessionId}, you receive
  all json-rpc notifications from the LSP process, but only responses to requests you make. If you
  establish a second connection, the second connection also receives all notifications, but only
  responses to requests it makes, and so forth.
- This works because when a connection talks to the LSP process, it is piped through a proxy that
  converts its numerical message IDs (json-rpc uses message IDs, and it's a convention, but not a
  requirement, to use sequential numerical ones) to UUIDs, storing the UUID --> numerical id in a
  map. When the response comes in, it is mapped to the correct WebSocket connection, the ID is
  converted back to the numerical one, and the entry in the map is removed.
- Inbound messages all go to the LSP proc of session ID, and similarly face this ID conversion.

Ideally we would use [Deno.Command](https://docs.deno.com/api/deno/~/Deno.Command), but VsCode
JSONRPC (the RPC library we're using to parse LSP messages) seems to require us to use Node streams,
so ChildProcess is just easier here.
