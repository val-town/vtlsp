# VTLSP Demo Deployment

This is a simple demo of our language server WebSocket server with a basic proxy to run the Deno language server.

There are two components, the language server client editor, and the WebSocket server.

The client is a React app that uses our codemirror client library, built with Vite to run as a Cloudflare Worker with an associated Cloudflare container to actually run the language server on.

The WebSocket server is a small wrapped version of the Deno language server using our LS proxy, served as a WebSocket server using our WebSocket server component.

