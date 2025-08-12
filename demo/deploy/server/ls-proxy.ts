import { LSPProxy, utils } from "@valtown/ls-ws-server";

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
  clientToProcMiddlewares: {
    initialize: async (params) => {
      await Deno.writeTextFile(`${TEMP_DIR}/deno.json`, JSON.stringify({})); // Create a deno.json in the temp dir
      return params;
    },
    "textDocument/didOpen": async (params) => {
      // Write file to temp directory when opened
      const tempFilePath = utils.virtualUriToTempDirUri(params.textDocument.uri, TEMP_DIR);
      if (tempFilePath) {
        const filePath = new URL(tempFilePath).pathname;
        await Deno.mkdir(filePath.substring(0, filePath.lastIndexOf('/')), { recursive: true });
        await Deno.writeTextFile(filePath, params.textDocument.text);
      }
      return params;
    },
    "textDocument/didChange": async (params) => {
      // Update file content when changed
      const tempFilePath = utils.virtualUriToTempDirUri(params.textDocument.uri, TEMP_DIR);
      if (tempFilePath) {
        const filePath = new URL(tempFilePath).pathname;
        // Apply content changes to get the full text
        const existingContent = await Deno.readTextFile(filePath).catch(() => "");
        let newContent = existingContent;
        
        for (const change of params.contentChanges) {
          if ('text' in change && !('range' in change)) {
            // Full document change
            newContent = change.text;
          }
        }
        
        await Deno.writeTextFile(filePath, newContent);
      }
      return params;
    },
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
