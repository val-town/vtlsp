import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";

export class VTLSPDemoContainer extends Container {
  public override sleepAfter = 90; // seconds
  public override defaultPort = 5002;
}

export default {
  fetch: new Hono<{ Bindings: Env }>()
    .use(honoLogger())
    .get("/demo", (c) => c.redirect(`/?id=${crypto.randomUUID()}`))
    .all("/lsp/*", async (c) => {
      const container = getContainer(
        c.env.VTLSP_DEMO_CONTAINER,
        c.req.query("id") || "default",
      );
      const url = new URL("/", c.req.url);
      url.search = c.req.url.split("?")[1] || "";
      const req = new Request(url, c.req.raw);
      return container.fetch(req);
    }).fetch,
} satisfies ExportedHandler<Env>;
