import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { cors } from "hono/cors";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { VAL_TOWN_LSP_CLIENT_COOKIE_NAME } from "./consts.js";
import { getContainer } from "./utils.js";
import { VTLSPContainer } from "../main.js";

export interface AppEnv extends Env {
  PROD_LSP_CONTAINER: DurableObjectNamespace<VTLSPContainer>;
  DEV_LSP_CONTAINER: DurableObjectNamespace<VTLSPContainer>;
}

export const app = new Hono<{ Bindings: AppEnv }>()
  .use(
    cors({
      origin: [
        "https://val.town",
        "https://www.val.town",
        "https://lsp.val.town",
        "https://lsp-dev.val.town",
        "http://localhost:3000",
      ],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: [
        "x-val-town-api-key",
        "Content-Type",
        "Upgrade",
        "Connection",
      ],
      exposeHeaders: ["Upgrade", "Connection"],
      credentials: true,
    })
  )
  .use(honoLogger())
  .post(
    "/auth",
    zValidator(
      "header",
      z.object({
        "x-val-town-api-key": z.string().regex(/^vtwn_[a-zA-Z0-9]+$/),
      })
    ),
    async (c) => {
      const { "x-val-town-api-key": apiKey } = c.req.valid("header");

      const userId = (await fetch("https://api.val.town/v1/me", {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
        .then((resp) => resp.json())
        .then((data: any) => data.id)) as string;

      if (!userId) return c.json({ error: "Invalid x-val-town-api-key" }, 401);

      await setSignedCookie(
        c,
        VAL_TOWN_LSP_CLIENT_COOKIE_NAME,
        userId,
        c.env.SIGNING_SECRET,
        { domain: process.env.COOKIE_DOMAIN, path: "/", secure: true }
      );

      c.status(204);

      return c.body(null);
    }
  )
  .post(
    "/admin",
    zValidator(
      "header",
      z.object({
        authorization: z.string().regex(/^Bearer vtwn_[a-zA-Z0-9]+$/),
      })
    ),
    zValidator(
      "json",
      z
        .discriminatedUnion("operation", [
          z.object({
            operation: z.literal("getContainerId"),
            userId: z.string().min(1),
          }),
          z.object({
            operation: z.literal("killContainer"),
            id: z.string().min(1).optional(),
            name: z.string().optional(),
            signal: z
              .enum(["SIGKILL", "SIGTERM"])
              .optional()
              .default("SIGTERM"),
          }),
        ])
        .refine((obj) => {
          switch (obj.operation) {
            case "killContainer":
              return obj.id || obj.name; // Ensure at least one of id or name is provided
            default:
              return true;
          }
        })
    ),
    async (c) => {
      const { authorization } = c.req.valid("header");
      const options = c.req.valid("json");
      const apiKey = authorization.replace("Bearer ", "");

      switch (options.operation) {
        case "killContainer": {
          const killContainerWithId = options.id;

          const userEmail = (await fetch("https://api.val.town/v1/me", {
            headers: { Authorization: `Bearer ${apiKey}` },
          })
            .then((resp) => resp.json())
            .then((data: any) => data.email)) as string;

          if (!userEmail || !userEmail.endsWith("@val.town")) {
            return c.json({ error: "Unauthorized" }, 403);
          }

          if (killContainerWithId) {
            const container = getContainer({
              containerId: killContainerWithId,
              env: c.env,
            });

            if (container) {
              await container.stop(options.signal === "SIGKILL" ? 9 : 15);
              return c.json(
                {
                  message: `Container ${killContainerWithId} killed successfully`,
                },
                200
              );
            } else {
              return c.json({ error: "Container not found" }, 404);
            }
          }
          break;
        }
        case "getContainerId": {
          const container = getContainer({
            env: c.env,
            userId: options.userId,
          });

          if (container) {
            return c.json(
              {
                id: container.id.toString(),
                name: container.name,
              },
              200
            );
          } else {
            return c.json({ error: "No container found" }, 404);
          }
        }
      }
    }
  )
  .post("/shutdown", async (c) => {
    const userId = await getSignedCookie(
      c,
      c.env.SIGNING_SECRET,
      VAL_TOWN_LSP_CLIENT_COOKIE_NAME
    );

    if (!userId) {
      return c.json(
        { error: "Missing or invalid val-town-lsp-client cookie" },
        401
      );
    }

    try {
      const container = getContainer({ userId, env: c.env });
      if (!container) {
        return c.json({ error: "No container found for user" }, 404);
      }

      try {
        await container.stop(15); // Send SIGTERM to the container

        return c.json({ message: "Container restarted successfully" }, 200);
      } catch (e) {
        return c.json({ error: "Failed to restart container" }, 500);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("not running")) {
        return c.json({ error: "Container is not running" }, 400);
      } else throw e;
    }
  })
  .get(
    "/logs",
    zValidator(
      "query",
      z.object({ n: z.coerce.number().int().positive().optional() })
    ),
    async (c) => {
      const userId = await getSignedCookie(
        c,
        c.env.SIGNING_SECRET,
        VAL_TOWN_LSP_CLIENT_COOKIE_NAME
      );
      if (userId) {
        console.log(`Fetching logs for user ${userId}`);
      }

      let containerLogs: Record<string, string> = {};

      if (userId) {
        const container = getContainer({ userId, env: c.env });
        if (!container) {
          console.warn(`No container found for user ${userId}`);
          return c.json({ error: "No container found for user" }, 404);
        }

        const resp = await container.fetch(c.req.url);
        try {
          containerLogs = await resp.json();
        } catch (e) {
          console.error(
            `Failed to parse container logs for user ${userId}: ${e}`
          );
        }
      }

      return c.json(containerLogs);
    }
  )
  .all("/lsp/*", async (c) => {
    if (c.req.routePath === "/lsp/logs") {
      console.warn("Redirecting /lsp/logs to /logs. Use /logs instead.");
      return c.redirect("/logs");
    }

    const userId = await getSignedCookie(
      c,
      c.env.SIGNING_SECRET,
      VAL_TOWN_LSP_CLIENT_COOKIE_NAME
    );

    if (!userId) {
      return c.json(
        { error: "Missing or invalid val-town-lsp-client cookie" },
        401
      );
    }

    console.info(`Handling LSP request for user ${userId}`);

    let container: ReturnType<typeof getContainer>;
    try {
      container = getContainer({ userId, env: c.env });
      if (!container) {
        return c.json({ error: "No container found for user" }, 404);
      }
    } catch (e) {
      console.error(e, `Failed to get a container for user ${userId}`);
      return c.json({ error: "Failed to get a container" }, 503);
    }

    console.info(
      `Handling LSP request for user ${userId} in container ${container.id}`
    );

    const originalRequest = c.req.raw;
    const url = new URL(originalRequest.url);
    url.pathname = url.pathname.replace(/^\/lsp/, "");
    const newRequest = new Request(url.toString(), originalRequest);
    console.log(
      `Forwarding Req for ${userId} to container ${container.id} @ ${newRequest.url}`
    );
    return await container.fetch(newRequest);
  })
  .onError((err, c) => {
    console.error(
      `Error in Hono app: ${err.name} - ${err.message}\nStack:\n${err.stack}`
    );
    return c.json(
      { error: `Internal error. ${err.message}\nStack:\n${err.stack}` },
      500
    );
  });
