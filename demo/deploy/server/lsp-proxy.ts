import { LSPProxy, utils } from "vtls-server";

const TEMP_DIR = await Deno.makeTempDir({ prefix: "vtlsp-proxy" });

const onExit = async () => await Deno.remove(TEMP_DIR, { recursive: true });
Deno.addSignalListener("SIGINT", onExit);
Deno.addSignalListener("SIGTERM", onExit);

const proxy = new LSPProxy({
  name: "lsp-server",
  tempDir: TEMP_DIR,
  exec: {
    command: "deno",
    args: ["lsp", "-q"],
  },
  uriConverters: {
    fromProcUri: (uriString: string) => {
      return utils.tempDirUriToVirtualUri(uriString, TEMP_DIR);
    },
    toProcUri: (uriString: string) => {
      return utils.virtualUriToTempDirUri(uriString, TEMP_DIR)!;
    },
  },
});

proxy.listen();
