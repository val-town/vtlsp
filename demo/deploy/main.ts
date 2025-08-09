import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";

export class VTLSPDemoContainer extends Container {
  public override sleepAfter = 30; // seconds
  public override defaultPort = 5002;
}

export default {
  fetch: new Hono<{ Bindings: Env }>()
    .use(honoLogger())
    .all("/lsp/*", async (c) => {
      const container = getContainer(
        c.env.VTLSP_DEMO_CONTAINER,
        c.req.query("id") || "default",
      );
      const req = new Request(new URL("/", c.req.url), c.req.raw);
      return container.fetch(req);
    }).fetch,
} satisfies ExportedHandler<Env>;
