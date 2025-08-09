import { parseArgs } from "@std/cli";
import { getApp } from "~/app.ts";
import { LSWSServer } from "~/lib/lsp/LSWSServer.ts";

const args = parseArgs(Deno.args, {
  default: {
    port: 5002,
    host: "0.0.0.0",
    shutdownAfter: 60*5, // 5 minutes
    "max-processes": 0,
    "ls-args": "",
    "ls-command": "",
  },
  string: ["ls-args", "ls-command"],
});

const port = Number(args.port);
const host = String(args.host);
const shutdownAfter = Number(args.shutdownAfter);

const maxProcs = Number(args["max-processes"]);
const lsCommand = args["ls-command"];
const lsArgs = args["ls-args"] ? args["ls-args"].split(",").filter(Boolean) : [];

const gracefulShutdown = (signal: string, code: number) => async () => {
  console.log(`Received ${signal}, shutting down`);
  await lsWsServer.shutdown();
  Deno.exit(code);
}

Deno.addSignalListener("SIGINT", gracefulShutdown("SIGINT", 130));
Deno.addSignalListener("SIGTERM", gracefulShutdown("SIGTERM", 143));

const lsWsServer = new LSWSServer({
  lsArgs,
  lsCommand,
  maxProcs,
  shutdownAfter,
  lsLogPath: Deno.makeTempDirSync({ prefix: "vtlsp-procs" }),
});

const app = getApp(lsWsServer);

Deno.serve({ port, hostname: host }, app.fetch);
