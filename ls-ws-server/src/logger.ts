import pino from "pino";

export const logger = pino(
  { level: process.env.CI ? "info" : "trace" },
  pino.destination({ dest: "./lsp-server.log" }),
);
