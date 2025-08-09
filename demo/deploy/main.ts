import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";

export class VTLSPContainer extends Container {
  public override sleepAfter = 30; // seconds
  public override defaultPort = 5002;
}

interface AppEnv {
  LSP_CONTAINER: DurableObjectNamespace<VTLSPContainer>;
}

interface Env extends AppEnv {}

export default {
  fetch: new Hono<{ Bindings: AppEnv }>()
    .use(honoLogger())
    .all("/lsp/*", async (c) => {
      const container = getContainer(c.env.LSP_CONTAINER, c.req.path);
      return container.fetch(c.req.raw);
    }).fetch,
} satisfies ExportedHandler<Env>;
