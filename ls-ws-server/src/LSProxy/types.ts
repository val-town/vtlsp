/** biome-ignore-all lint/suspicious/noExplicitAny: specifically broad handlers */

import type { Logger } from "~/logger.js";
import type { codes } from "./codes.js";
import type { LSPNotifyMap, LSPRequestMap } from "./types.lsp.js";

type MaybePromise<T> = T | Promise<T>;

export type LSProxyCode = (typeof codes)[keyof typeof codes];

// Let the proxy include a "ls_proxy_code" property to change how the request is handled. Right
// now we just support the "cancel_response" code, which tells the proxy to cancel the response
// to the client (or process).
export type MaybeWithLSProxyCode<T> = T | (T & { ls_proxy_code: LSProxyCode });

export type ParamsMiddlewareFunction<T = any> = (
  params: T,
) => MaybePromise<MaybeWithLSProxyCode<T>>; // modifies params

export type ResultMiddlewareFunction<T = any, K = any> = (
  result: T,
  params?: K,
) => MaybePromise<MaybeWithLSProxyCode<T>>; // modifies result

export type CatchAllMiddlewareFunction = (
  method: string,
  params: unknown,
  result?: unknown,
) => MaybePromise<MaybeWithLSProxyCode<unknown>>;

export type HandlerFunction<T = any, R = any> = (
  params: T,
) => MaybePromise<MaybeWithLSProxyCode<R>>;

export type CatchAllHandlerFunction = (
  method: string,
  params: unknown,
) => MaybePromise<MaybeWithLSProxyCode<unknown>>;

export type LSProxyClientToProcHandlers = {
  [K in keyof LSPNotifyMap]?: HandlerFunction<LSPNotifyMap[K], void>;
} & {
  [K in keyof LSPRequestMap]?: HandlerFunction<
    LSPRequestMap[K][0],
    LSPRequestMap[K][1]
  >;
} & Record<string, HandlerFunction | CatchAllHandlerFunction | undefined>;

export type LSProxyProcToClientHandlers = {
  [K in keyof LSPNotifyMap]?: HandlerFunction<LSPNotifyMap[K], void>;
} & {
  [K in keyof LSPRequestMap]?: HandlerFunction<
    LSPRequestMap[K][1],
    LSPRequestMap[K][1]
  >;
} & Record<string, HandlerFunction | CatchAllHandlerFunction | undefined>;

export type LSProxyClientToProcMiddlewares = {
  [K in keyof LSPNotifyMap]?: ParamsMiddlewareFunction<LSPNotifyMap[K]>;
} & {
  [K in keyof LSPRequestMap]?: ResultMiddlewareFunction<
    LSPRequestMap[K][0],
    LSPRequestMap[K][1]
  >;
} & Record<
    string,
    | ParamsMiddlewareFunction
    | ResultMiddlewareFunction
    | CatchAllMiddlewareFunction
  >;

export type LSProxyProcToClientMiddlewares = {
  [K in keyof LSPNotifyMap]?: ParamsMiddlewareFunction<LSPNotifyMap[K]>;
} & {
  // (result)
  [K in keyof LSPRequestMap]?: ResultMiddlewareFunction<
    LSPRequestMap[K][1],
    LSPRequestMap[K][0]
  >;
} & Record<
    // (result, original-params)
    string,
    | ParamsMiddlewareFunction
    | ResultMiddlewareFunction
    | CatchAllMiddlewareFunction
  >; // (method, original-params, result)

export type LSProxyCallbacks = {
  onNotification?: (method: string, params: any) => MaybePromise<void>;
  onRequest?: (method: string, params: any) => MaybePromise<any>;
};

/**
 * A set of functions to convert URIs between the language server process format and the consumer client format.
 *
 * One common use case here is to convert file paths between being relative to a
 * temp path and a virtual root. For example, a user editing files in a browser
 * may want to convert deal with paths that look like "/bar.ts," but, for
 * security reasons, on disc want to contain those files in a temporary
 * directory like `/tmp/ls-proxy/bar.ts`.
 */
export type UriConverters = {
  /**
   * Converts a URI from the language server process format to the consumer client format.
   *
   * @param uri The URI in the language server process format.
   * @returns The URI in the consumer client format.
   */
  toProcUri: (uri: string) => string;
  /**
   * Converts a URI from the consumer client format to the language server process format.
   *
   * @param uri The URI in the consumer client format.
   * @returns The URI in the language server process format.
   */
  fromProcUri: (uri: string) => string;
};

export type LSPExec = {
  /** The command to execute the language server process.  */
  command: string;
  /** Arguments to pass to the command. If not provided, the default is an empty array.  */
  args?: string[];
  /**
   * Either a dictionary of environment variables to set for the process, or a
   * function that returns a promise that resolves to such a dictionary.
   */
  env?: () => MaybePromise<{ [K: string]: string }> | Record<string, string>;
  /**
   * Lifecycle callbacks for the language server process.
   */
  callbacks?: {
    /** Called before the language server process is spawned. */
    preSpawn?: () => MaybePromise<void>;
    /** Called after the language server process is spawned. */
    postSpawn?: () => MaybePromise<void>;
    /** Called when the language server process exits. */
    onExit?: (code: number | null) => MaybePromise<void>;
    /** Called when the language server process encounters an error. */
    onError?: (error: Error) => MaybePromise<void>;
  };
};

export interface LSProxyParams {
  name: string;
  /**
   * Information to spawn the language server process.
   */
  exec: LSPExec;
  /**
   * Input stream for receiving messages from the LSP client.
   *
   * @default process.stdin
   */
  inputStream?: NodeJS.ReadableStream;
  /**
   * Output stream for sending messages to the LSP client.
   *
   * @default process.stdout
   */
  outputStream?: NodeJS.WritableStream;
  /** Logger for the LSP proxy */
  logger?: Logger;
  /**
   * Callbacks that intercept and maybe transform messages sent from the language server consumer client en route to the language server process.
   */
  clientToProcMiddlewares?: LSProxyClientToProcMiddlewares;
  /**
   * Callbacks that intercept and maybe transform messages sent from the language server process en route to the language server consumer client.
   */
  procToClientMiddlewares?: LSProxyProcToClientMiddlewares;
  /**
   * Callbacks that handle messages sent from the language server consumer client en route to the language server process.
   */
  clientToProcHandlers?: LSProxyClientToProcHandlers;
  /**
   * Callbacks that handle messages sent from the language server process en route to the language server consumer client.
   */
  procToClientHandlers?: LSProxyProcToClientHandlers;
  /**
   * Callbacks that handle messages sent from the language server consumer client or process.
   */
  uriConverters: UriConverters;
  /**
   * The working directory for the language server process.
   *
   * Language servers are often finicky about the file system, and in many cases use file system watchers to detect specific types of changes.
   *
   * @default process.cwd()
   */
  cwd: string;
  lsLogStderrPath?: string;
  lsLogStdoutPath?: string;
}
