// deno-lint-ignore-file no-explicit-any

import type { LSPNotifyMap, LSPRequestMap } from "../../types/lspTypes.ts";
import type { codes } from "./codes.ts";

type MaybePromise<T> = T | Promise<T>;

export type LSProxyCode = typeof codes[keyof typeof codes];

// Let the proxy include a "ls_proxy_code" property to change how the request is handled. Right
// now we just support the "cancel_response" code, which tells the proxy to cancel the response
// to the client (or process).
export type MaybeWithLSProxyCode<T> =
  | T
  | (T & { ls_proxy_code: LSProxyCode });

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

export type LSPProxyClientToProcHandlers =
  & { [K in keyof LSPNotifyMap]?: HandlerFunction<LSPNotifyMap[K], void> }
  & {
    [K in keyof LSPRequestMap]?: HandlerFunction<
      LSPRequestMap[K][0],
      LSPRequestMap[K][1]
    >;
  }
  & Record<string, HandlerFunction | CatchAllHandlerFunction | undefined>;

export type LSPProxyProcToClientHandlers =
  & { [K in keyof LSPNotifyMap]?: HandlerFunction<LSPNotifyMap[K], void> }
  & {
    [K in keyof LSPRequestMap]?: HandlerFunction<
      LSPRequestMap[K][1],
      LSPRequestMap[K][1]
    >;
  }
  & Record<string, HandlerFunction | CatchAllHandlerFunction | undefined>;

export type LSPProxyClientToProcMiddlewares =
  & { [K in keyof LSPNotifyMap]?: ParamsMiddlewareFunction<LSPNotifyMap[K]> }
  & {
    [K in keyof LSPRequestMap]?: ResultMiddlewareFunction<
      LSPRequestMap[K][0],
      LSPRequestMap[K][1]
    >;
  }
  & Record<
    string,
    | ParamsMiddlewareFunction
    | ResultMiddlewareFunction
    | CatchAllMiddlewareFunction
  >;

export type LSPProxyProcToClientMiddlewares =
  & { [K in keyof LSPNotifyMap]?: ParamsMiddlewareFunction<LSPNotifyMap[K]> } // (result)
  & {
    [K in keyof LSPRequestMap]?: ResultMiddlewareFunction<
      LSPRequestMap[K][1],
      LSPRequestMap[K][0]
    >;
  } // (result, original-params)
  & Record<
    string,
    | ParamsMiddlewareFunction
    | ResultMiddlewareFunction
    | CatchAllMiddlewareFunction
  >; // (method, original-params, result)

export type LSPProxyCallbacks = {
  onNotification?: (method: string, params: any) => MaybePromise<void>;
  onRequest?: (method: string, params: any) => MaybePromise<any>;
};

export type UriConverters = {
  toProcUri: (uri: string) => string;
  fromProcUri: (uri: string) => string;
};

export type LSPExec = {
  command: string;
  args: string[];
  env: () => MaybePromise<{ [K: string]: string }>;
  callbacks?: {
    preSpawn?: () => MaybePromise<void>;
    postSpawn?: () => MaybePromise<void>;
    onExit?: (code: number | null) => MaybePromise<void>;
    onError?: (error: Error) => MaybePromise<void>;
  };
};

export interface LSPProxyParams {
  name: string;
  exec: LSPExec;
  clientToProcMiddlewares?: LSPProxyClientToProcMiddlewares;
  procToClientMiddlewares?: LSPProxyProcToClientMiddlewares;
  clientToProcHandlers?: LSPProxyClientToProcHandlers;
  procToClientHandlers?: LSPProxyProcToClientHandlers;
  uriConverters: UriConverters;
  tempDir: string;
  lsLogStderrPath?: string;
  lsLogStdoutPath?: string;
}
