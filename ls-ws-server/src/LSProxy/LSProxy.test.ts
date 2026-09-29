/** biome-ignore-all lint/suspicious/noExplicitAny: useful for tests */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { LSProxy } from "./LSProxy.ts";
import type { LSProxyProcToClientMiddlewares } from "./types.ts";

function applyResponseMiddleware(
  middlewares: LSProxyProcToClientMiddlewares,
  params: unknown,
  resp: unknown,
) {
  const proxy = new LSProxy({
    name: "test",
    cwd: "/tmp",
    exec: { command: "true" },
    inputStream: new PassThrough(),
    outputStream: new PassThrough(),
    procToClientMiddlewares: middlewares,
    uriConverters: { fromProcUri: (u) => u, toProcUri: (u) => u },
  });
  // Mirrors how the client request handler applies response middleware.
  return (proxy as any).applyMiddleware(
    "textDocument/completion",
    params,
    middlewares,
    true,
    resp,
    false,
  );
}

describe("LSProxy response middleware", () => {
  const params = {
    textDocument: { uri: "file:///a.ts" },
    position: { line: 0, character: 0 },
  };

  it("passes a null response to the middleware, not the request params", async () => {
    let received: unknown = "unset";
    const result = await applyResponseMiddleware(
      {
        "textDocument/completion": (result, receivedParams) => {
          received = result;
          expect(receivedParams).toEqual(params);
          return result;
        },
      },
      params,
      null,
    );
    expect(received).toBeNull();
    expect(result).toBeNull();
  });

  it("passes a non-null response to the middleware", async () => {
    const resp = { isIncomplete: false, items: [{ label: "a" }] };
    const result = await applyResponseMiddleware(
      {
        "textDocument/completion": (result) => ({
          ...(result as any),
          items: [],
        }),
      },
      params,
      resp,
    );
    expect(result).toEqual({ isIncomplete: false, items: [] });
  });
});
