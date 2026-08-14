import * as path from "node:path";
import { LSProxy } from "@valtown/ls-ws-server";
import { utils } from "@valtown/ls-ws-server/proxy";

const TEMP_DIR = await Deno.makeTempDir({ prefix: "vtlsp-proxy" });
const TEMP_DIR_RESOLVED = path.resolve(TEMP_DIR);

/**
 * Defense in depth for the virtual-FS materialization sinks (C1).
 *
 * `virtualUriToTempDirUri` now guarantees its result stays inside TEMP_DIR, but
 * this layer re-verifies the *derived* filesystem path (after `new URL(...).pathname`
 * re-normalization) before any read/write/mkdir, so a future regression in the
 * mapping can never become an arbitrary absolute-path write again.
 *
 * Requires a strict child of TEMP_DIR (not the root itself).
 *
 * @returns The verified absolute path, or null if it escapes the temp dir.
 */
const safeTempFilePath = (tempFilePath: string): string | null => {
  const filePath = path.resolve(new URL(tempFilePath).pathname);
  if (filePath.startsWith(`${TEMP_DIR_RESOLVED}${path.sep}`)) {
    return filePath;
  }
  return null;
};

const onExit = async () => await Deno.remove(TEMP_DIR, { recursive: true });
Deno.addSignalListener("SIGINT", onExit);
Deno.addSignalListener("SIGTERM", onExit);

const proxy = new LSProxy({
  name: "lsp-server",
  cwd: TEMP_DIR,
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
      const tempFilePath = utils.virtualUriToTempDirUri(
        params.textDocument.uri,
        TEMP_DIR,
      );
      const filePath = tempFilePath ? safeTempFilePath(tempFilePath) : null;
      if (filePath) {
        await Deno.mkdir(filePath.substring(0, filePath.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(filePath, params.textDocument.text);
      }
      return params;
    },
    "textDocument/didChange": async (params) => {
      // Update file content when changed
      const tempFilePath = utils.virtualUriToTempDirUri(
        params.textDocument.uri,
        TEMP_DIR,
      );
      const filePath = tempFilePath ? safeTempFilePath(tempFilePath) : null;
      if (filePath) {
        // Apply content changes to get the full text
        const existingContent = await Deno.readTextFile(filePath).catch(
          () => "",
        );
        let newContent = existingContent;

        for (const change of params.contentChanges) {
          if ("text" in change && !("range" in change)) {
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
      // Fall back to the original URI when the mapping is rejected: keeps
      // message payloads intact (no `undefined` injection into JSON-RPC params)
      // while materialization sinks stay safe.
      return utils.virtualUriToTempDirUri(uriString, TEMP_DIR) ?? uriString;
    },
  },
});

proxy.listen();
