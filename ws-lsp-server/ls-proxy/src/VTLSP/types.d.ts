import type { TextDocumentIdentifier } from "vscode-languageserver-protocol";

/**
 * deno/cache will instruct Deno to attempt to cache a module and all of its
 * dependencies. If a referrer only is passed, then all dependencies for the
 * module specifier will be loaded. If there are values in the uris, then only
 * those uris will be cached.
 *
 * @see https://docs.deno.com/runtime/reference/lsp_integration/
 */
export type DenoCacheParams = {
  referrer: TextDocumentIdentifier;
  uris: TextDocumentIdentifier[];
};

export type EnvVarsNotification = {
  envVars: { key: string; description?: string }[];
};

export type PingParams = Record<string | number | symbol, never>;

export type ReinitFilesNotification = {
  files: {
    uri: string;
    text: string;
  }[];
};

export type ReadFileParams = {
  textDocument: TextDocumentIdentifier;
};

export type ReadFileResult = {
  text?: string;
};
