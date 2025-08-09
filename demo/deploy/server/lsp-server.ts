/** biome-ignore-all lint/suspicious/noConsole: debug logging */

import { LSWSServer } from "vtls-server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const PORT = 5002;
const HOSTNAME = "0.0.0.0";
const SHUTDOWN_AFTER = 60 * 5; // 5 minutes
const MAX_PROCS = 1;
const LS_COMMAND = "deno";
const LS_ARGS: string[] = ["run", "-A", "./lsp-proxy.ts"];

const lsWsServer = new LSWSServer({
  lsArgs: LS_ARGS,
  lsCommand: LS_COMMAND,
  maxProcs: MAX_PROCS,
  shutdownAfter: SHUTDOWN_AFTER,
  lsLogPath: Deno.makeTempDirSync({ prefix: "vtlsp-procs" }),
});

const gracefulShutdown = (signal: string, code: number) => async () => {
  console.log(`Received ${signal}, shutting down`);
  await lsWsServer.shutdown();
  Deno.exit(code);
};

Deno.addSignalListener("SIGINT", gracefulShutdown("SIGINT", 130));
Deno.addSignalListener("SIGTERM", gracefulShutdown("SIGTERM", 143));

function getApp(lsWsServer: LSWSServer) {
  return new Hono()
    .get("/", zValidator("query", z.object({ session: z.string() })), (c) => {
      console.log("Received request:", c.req.raw.method, c.req.raw.url);
      return lsWsServer.handleNewWebsocket(
        c.req.raw,
        c.req.valid("query").session,
      );
    })
    .use(async (c, next) => {
      c.header("Content-Encoding", "Identity");
      await next();
    });
}

const app = getApp(lsWsServer);

Deno.serve({ port: PORT, hostname: HOSTNAME }, app.fetch);
