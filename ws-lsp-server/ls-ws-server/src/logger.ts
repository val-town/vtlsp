import { pino } from "pino";

export const logger = pino(
  { level: Deno.env.get("CI") ? "info" : "trace" },
  pino.destination({ dest: "./lsp-server.log" }),
);
