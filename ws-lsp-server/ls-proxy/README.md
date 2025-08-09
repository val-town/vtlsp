This is a custom Language Server Protocol implementation that wraps the Deno language server to add
various special Val Town features. It uses a custom LSPProxy class that lets you attach middlewares
to client->lsp proc and lsp proc->client (where the client is stdout/stdin usually)

- [x] Magic env var suggestions. We expose a `vtlsp/setEnvVars` that gives the global scope context
      of env vars, so that you get suggestions for Deno.env.get and process.env with some en var
      keys
- `apiKey` parameter for initiate options, so that Deno can access private modules
- [x] Modules always are automatically cached upon import. When we see Deno offer us a cache code
      action we instantly take it. We never tell the user a module isn't cached. Deno LSP has a
      request we can make to initiate a cache!
- [ ] Hide "/tmp/..." stuff. Deno runs in a temp dir and places all relative imports into the temp
      dir. We can hide the temp in the outbound diagnostics from Deno. This shows up when you hover
      over the import URL and see "resolved as /tmp/...".
- [ ] Add code action and diagnostic for when you're missing JSX comment at top of file
