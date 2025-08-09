import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { denoFormat, DenoFormatConfigurationSchema } from "./lib/format.ts";
import { removeApiKeyFromString } from "./lib/utils.ts";
import { expandGlob } from "@std/fs";
import type { LSWSServer } from "./lib/lsp/LSWSServer.ts";

export function getApp(lsWsServer: LSWSServer) {
  return new Hono()
    .get(
      "/ws",
      zValidator(
        "query",
        z.object({
          session: z.string(),
        }),
      ),
      (c) =>
        lsWsServer.handleNewWebsocket(
          c.req.raw,
          c.req.valid("query").session,
        ),
    )
    .use(async (c, next) => {
      c.header("Content-Encoding", "Identity");
      return await next();
    })
    .use(cors({
      origin: ["http://localhost:3000", "http://localhost:5002"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "x-val-town-api-key", "Cookie"],
      credentials: true,
    }))
    .get("/ping", (c) => c.text("pong"))
    .post(
      // When a tab clicks "reload the LSP" it hits this endpoint, and then everyone tries to reconnect
      "/kill",
      zValidator(
        "json",
        z.object({
          session: z.string(),
        }),
      ),
      (c) => {
        const { session } = c.req.valid("json");

        try {
          lsWsServer.closeSession(session);
          return c.text("Session killed successfully", 200);
        } catch (error) {
          console.error("Error killing session:", error);
          return c.text("Failed to kill session", 500);
        }
      },
    )
    .post(
      "/format",
      zValidator(
        "json",
        z.object({
          text: z.string(),
          config: DenoFormatConfigurationSchema.optional(),
          path: z.string(),
        }),
      ),
      async (c) => {
        try {
          const { config, text, path } = c.req.valid("json");
          const formattedContent = await denoFormat({ path, config, text });
          return c.text(formattedContent, 200);
        } catch (error) {
          console.error("Error formatting text:", error);
          return c.text("Failed to format text", 500);
        }
      },
    )
    .get(
      "/logs",
      zValidator(
        "query",
        z.object({
          n: z.coerce.number().int().optional(),
          sessionCount: z.coerce.number().int().optional(),
        }),
      ),
      async (c) => {
        const { n = Number.POSITIVE_INFINITY } = c.req.valid("query");

        const logContents: Record<string, string> = {};

        for await (const entry of expandGlob("/{app,tmp}/**/*.log")) {
          if (entry.isFile && entry.name.endsWith(".log")) {
            let content = await Deno.readTextFile(entry.path);

            if (n !== Number.POSITIVE_INFINITY) {
              content = content.slice(-n);
            }

            content = removeApiKeyFromString(content);

            logContents[`Log File - ${entry.path}`] = content;
          }
        }

        return c.json(logContents);
      },
    )
    .get(
      "/fs/*",
      serveStatic({
        root: "/",
        rewriteRequestPath: (path) => {
          return path.replace(/^\/fs/, "");
        },
      }),
    );
}
