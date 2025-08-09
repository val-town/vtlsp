import { pino } from "pino";

export const logger = pino(
  { level: "trace" },
  pino.destination({ dest: "./lsp-ls.log" }),
);
