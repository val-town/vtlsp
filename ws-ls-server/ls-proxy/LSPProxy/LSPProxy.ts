// deno-lint-ignore-file no-explicit-any

import * as rpc from "vscode-jsonrpc/node.js";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import type {
  CatchAllHandlerFunction,
  CatchAllMiddlewareFunction,
  HandlerFunction,
  LSPExec,
  LSPProxyClientToProcHandlers,
  LSPProxyClientToProcMiddlewares,
  LSPProxyParams,
  LSPProxyProcToClientHandlers,
  LSPProxyProcToClientMiddlewares,
  ParamsMiddlewareFunction,
  ResultMiddlewareFunction,
  UriConverters,
} from "./types.d.ts";
import process from "node:process";
import { isLspParamsLike, isLspRespLike, replaceFileUris } from "./utils.ts";
import { logger } from "../logger.ts";
import type { LSPNotifyMap, LSPRequestMap } from "./types.lsp.d.ts";
import { hasALsProxyCode } from "./codes.ts";

/**
 * LSPProxy creates a bridge between a client and a language server process.
 *
 * It spawns the language server, handles communication between the client and
 * server, and provides middleware hooks for intercepting and modifying
 * messages. Then, it rebroadcasts the messages to act as an LSP.
 */
export class LSPProxy {
  /** The temp directory that the LSP process is running in. */
  public tempDir: string;

  /** The spawned language server process */
  public process: ChildProcessWithoutNullStreams | null = null;

  /** Connection to the language server process */
  public procConn: rpc.MessageConnection | null = null;

  /** Connection to the LSP client */
  public clientConn: rpc.MessageConnection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(process.stdin),
    new rpc.StreamMessageWriter(process.stdout),
  );

  /** Configuration for the language server executable */
  #execOptions: LSPExec;

  /** Middlewares and handlers for communication between client and process */
  #clientToProcMiddlewares: LSPProxyClientToProcMiddlewares;
  #procToClientMiddlewares: LSPProxyProcToClientMiddlewares;

  #clientToProcHandlers: LSPProxyClientToProcHandlers;
  #procToClientHandlers: LSPProxyProcToClientHandlers;

  /** Custom methods for the LSP proxy */
  // biome-ignore lint/suspicious/noExplicitAny: Allowing any type for custom methods
  #customMethods: { [key: string]: (params: any) => any | Promise<any> } = {};

  /** Converters for transforming URIs between client and server formats */
  #uriConverters: UriConverters;

  #lsLogStderrPath?: string;
  #lsLogStdoutPath?: string;

  /** Prefix for the temp dir that the LSP runs in. */
  readonly name: string;

  /** Promise that resolves when the LSP process is running */
  public processRunningPromise: Promise<void>;
  private processRunningResolve!: () => void;

  constructor({
    exec,
    clientToProcMiddlewares,
    procToClientMiddlewares,
    clientToProcHandlers,
    procToClientHandlers,
    uriConverters,
    name,
    tempDir,
    lsLogStderrPath,
    lsLogStdoutPath,
  }: LSPProxyParams) {
    this.#execOptions = exec;
    this.#clientToProcMiddlewares = clientToProcMiddlewares ?? {};
    this.#procToClientMiddlewares = procToClientMiddlewares ?? {};
    this.#clientToProcHandlers = clientToProcHandlers ?? {};
    this.#procToClientHandlers = procToClientHandlers ?? {};
    this.#uriConverters = uriConverters;
    this.name = name;
    this.tempDir = tempDir;

    this.#lsLogStderrPath = lsLogStderrPath;
    this.#lsLogStdoutPath = lsLogStdoutPath;

    // Create the process running promise
    this.processRunningPromise = new Promise<void>((resolve) => {
      this.processRunningResolve = resolve;
    });

    // Note, this.setupProcToClient() get's called during the initialization request
    this.setupClientToProc();
  }

  /**
   * Start the LSP process and listen for messages.
   */
  public async listen() {
    await this.startProc();
    this.clientConn.listen();
  }

  /**
   * Send a notification to the LSP process.
   *
   * @param method The LSP method (e.g. "textDocument/didOpen")
   * @param params The parameters for the method
   */
  public sendNotification<K extends keyof LSPNotifyMap>(
    method: K,
    params: LSPNotifyMap[K],
  ): void {
    this.sendNotificationUnsafe(method, params);
  }

  // biome-ignore lint/suspicious/noExplicitAny: explicitly unsafe method
  public sendNotificationUnsafe(method: string, params: any): void {
    logger.debug({ method, params }, "Sending notification to process");

    this.clientConn.sendNotification(method, params);
  }

  /**
   * Send a request to the LSP process.
   *
   * @param method The LSP method (e.g. "textDocument/definition")
   * @param params The parameters for the method
   */
  public async sendRequest<K extends keyof LSPRequestMap>(
    method: K,
    params: LSPRequestMap[K][0],
  ): Promise<LSPRequestMap[K][1]> {
    return await this.sendRequestUnsafe(method, params);
  }

  public async sendRequestUnsafe(
    method: string,
    // biome-ignore lint/suspicious/noExplicitAny: explicitly unsafe method
    params: any,
  ): Promise<unknown> {
    logger.debug({ method, params }, "Sending request to process");

    if (!this.procConn) {
      throw new Error("LSP process connection not initialized");
    }

    return await this.procConn.sendRequest(method, params);
  }

  /**
   * Send a shutdown notification to the LSP process.
   */
  public sendShutdown(): void {
    logger.debug("Sending shutdown notification to process");

    this.clientConn.sendNotification("shutdown");
  }

  private async startProc(): Promise<void> {
    if (this.process) {
      logger.debug("LSP process already running");
      return;
    }

    if (this.#execOptions.callbacks?.preSpawn) {
      await this.#execOptions.callbacks.preSpawn();
      logger.debug("Pre process spawn callback executed");
    }

    this.process = spawn(this.#execOptions.command, this.#execOptions.args, {
      cwd: this.tempDir,
      env: {
        ...process.env,
        ...(typeof this.#execOptions.env === "function"
          ? await this.#execOptions.env()
          : this.#execOptions.env || {}),
      },
    });

    if (this.#lsLogStdoutPath) {
      this.process.stdout.pipe(
        fs.createWriteStream(this.#lsLogStdoutPath, { flags: "a" }),
      );
    }

    if (this.#lsLogStderrPath) {
      this.process.stderr.pipe(
        fs.createWriteStream(this.#lsLogStderrPath, { flags: "a" }),
      );
    }

    logger.debug({ pid: this.process.pid }, "LS process started");

    if (this.#execOptions.callbacks?.postSpawn) {
      await this.#execOptions.callbacks.postSpawn();
      logger.debug("Post process spawn callback executed");
    }

    this.procConn = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.process.stdout),
      new rpc.StreamMessageWriter(this.process.stdin),
    );

    this.process.on("exit", (code) => {
      logger.debug("LS process exited");

      this.#execOptions.callbacks?.onExit?.(code);
      this.process = null;
      this.procConn = null;
    });

    this.process.on("error", (error) => {
      logger.error({ error }, "Error in LS process");

      this.#execOptions.callbacks?.onError?.(error);
      this.process = null;
      this.procConn = null;
    });

    this.process.on("close", (code) => {
      logger.debug({ code }, "LS process closed");

      this.process = null;
      this.procConn = null;
    });

    this.setupProcToClient();
    logger.debug("LS process connection setup");

    this.procConn.listen();

    // Resolve the process running promise after everything is set up and listening
    this.processRunningResolve();
  }

  private setupProcToClient(): void {
    if (!this.procConn)
      throw new Error("LSP process connection not initialized");

    this.procConn.onNotification(async (method, params) => {
      logger.debug({ method, params }, "Received notification from process");

      const transformedParams = replaceFileUris(
        params,
        this.#uriConverters.fromProcUri,
      );
      if (!isLspParamsLike(transformedParams))
        throw new Error("Failed to transform params from process");
      params = transformedParams;

      const handlerResult = await this.applyHandler(
        method,
        params,
        this.#procToClientHandlers,
        false,
      );
      if (handlerResult !== null) {
        if (
          hasALsProxyCode(handlerResult) &&
          handlerResult.ls_proxy_code === "cancel_response"
        ) {
          return;
        }
        return handlerResult;
      }

      params = await this.applyMiddleware(
        method,
        params,
        this.#procToClientMiddlewares,
        false,
      );
      logger.debug({ method, params }, "Transformed params from process");
      if (hasALsProxyCode(params) && params.ls_proxy_code === "cancel_response")
        return;

      this.clientConn.sendNotification(method, params);
    });

    this.procConn.onRequest(async (method, params) => {
      logger.debug({ method, params }, "Received request from process");

      const transformedParams = replaceFileUris(
        params,
        this.#uriConverters.fromProcUri,
      );
      if (!isLspParamsLike(transformedParams))
        throw new Error("Failed to transform params from process");
      params = transformedParams;

      const handlerResult = await this.applyHandler(
        method,
        params,
        this.#procToClientHandlers,
        true,
      );
      if (handlerResult !== null) return handlerResult;

      params = await this.applyMiddleware(
        method,
        params,
        this.#procToClientMiddlewares,
        true,
      );
      logger.debug({ method, params }, "Transformed params from process");
      if (hasALsProxyCode(params) && params.ls_proxy_code === "cancel_response")
        return;

      return this.clientConn.sendRequest(method, params);
    });
  }

  private setupClientToProc() {
    this.clientConn.onNotification(async (method, params) => {
      logger.debug({ method, params }, "Received notification from client");

      const transformedParams = replaceFileUris(
        params,
        this.#uriConverters.toProcUri,
      );
      if (!isLspParamsLike(transformedParams))
        throw new Error("Failed to transform params from client");
      params = transformedParams;

      const handlerResult = await this.applyHandler(
        method,
        params,
        this.#clientToProcHandlers,
        false,
      );
      logger.debug({ method, params }, "Applied client-to-proc handler");

      if (handlerResult !== null) {
        // If a handler was found and executed, return its result if not a cancel response
        if (
          hasALsProxyCode(handlerResult) &&
          handlerResult.ls_proxy_code === "cancel_response"
        ) {
          return;
        }
        return handlerResult;
      }

      params = await this.applyMiddleware(
        method,
        params,
        this.#clientToProcMiddlewares,
        false,
      );
      logger.debug({ method, params }, "Applied client-to-proc middleware");
      if (hasALsProxyCode(params) && params.ls_proxy_code === "cancel_response")
        return;

      this.procConn?.sendNotification(method, params);
    });

    this.clientConn.onRequest(async (method, params) => {
      logger.debug({ method, params }, "Received request from client");

      // First check if there's a handler for this request
      const handlerResult = await this.applyHandler(
        method,
        params,
        this.#clientToProcHandlers,
        true,
      );
      logger.debug({ method, params }, "Applied client-to-proc handler");

      if (handlerResult !== null) {
        // If a handler was found and executed, return its result if not a cancel response
        if (
          hasALsProxyCode(handlerResult) &&
          handlerResult.ls_proxy_code === "cancel_response"
        ) {
          return;
        }
        return handlerResult;
      }

      // Otherwise, apply middleware
      params = await this.applyMiddleware(
        method,
        params,
        this.#clientToProcMiddlewares,
        true,
        null, // No result yet, since this is a request
      );
      logger.debug({ method, params }, "Applied client-to-proc middleware");

      if (hasALsProxyCode(params) && params.ls_proxy_code === "cancel_response")
        return;

      // Check for custom method handlers for requests
      if (method in this.#customMethods) {
        const customMethod = this.#customMethods[method];
        return customMethod(params);
      }

      // Send the request to the server
      if (!this.procConn)
        throw new Error("LSP process connection not initialized");

      const transformedParams = replaceFileUris(
        params,
        this.#uriConverters.toProcUri,
      ); // params are from client, so we convert to proc URI
      if (!isLspParamsLike(transformedParams))
        throw new Error(
          "Failed to transform params from client, got: " +
            JSON.stringify(transformedParams),
        );
      if (!this.procConn)
        throw new Error("LSP process connection not initialized");

      let resp = (await this.procConn.sendRequest(
        method,
        transformedParams,
      )) as LSPRequestMap[keyof LSPRequestMap];
      logger.debug({ method, params }, "Got response from process");

      const transformedResp = replaceFileUris(
        resp,
        this.#uriConverters.fromProcUri,
      ); // response is from process, so we convert to client URI
      if (!isLspRespLike(transformedResp))
        throw new Error(
          "Failed to transform response from process, got: " +
            JSON.stringify(transformedResp),
        );
      resp = transformedResp as typeof resp; // Resp is "more specific"
      logger.debug({ method, params }, "Transformed response from process");

      // If there's a procToClient middleware, apply it to the response
      if (
        this.#procToClientMiddlewares[
          method as string & keyof LSPProxyProcToClientMiddlewares
        ]
      ) {
        const result = await this.applyMiddleware(
          method,
          params, // they get back the original params, which have client paths
          this.#procToClientMiddlewares,
          true,
          resp,
          false, // This is proc-to-client, so we don't modify params
        );
        if (result.ls_proxy_code === "cancel_response") return;
        return result;
      }

      // If no middleware, return the original response
      return resp;
    });
  }

  private async applyMiddleware(
    method: string,
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary params for middleware
    params: any,
    middlewares:
      | LSPProxyClientToProcMiddlewares
      | LSPProxyProcToClientMiddlewares,
    isRequest = false,
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary result for middleware
    result: any | null = null,
    isClientToProc = true,
    // biome-ignore lint/suspicious/noExplicitAny: TODO: make this more specific
  ): Promise<any> {
    let modifiedValue = result !== null ? result : params;

    // Apply exact method middleware if available
    const exactMatch = middlewares[method];
    if (exactMatch) {
      if (isClientToProc || !isRequest) {
        // For client-to-proc, or proc-to-client notifications, we modify params
        modifiedValue = await (exactMatch as ParamsMiddlewareFunction)(
          modifiedValue,
        );
        logger.trace(
          { method, params, modifiedValue },
          "Applied exact method middleware",
        );
        if (modifiedValue.ls_proxy_code === "cancel_response")
          return modifiedValue;
      } else {
        // For proc-to-client requests, we modify result with original params as context
        modifiedValue = await (exactMatch as ResultMiddlewareFunction)(
          modifiedValue,
          params,
        );
        logger.trace(
          { method, params, modifiedValue },
          "Applied exact method middleware",
        );
        if (modifiedValue.ls_proxy_code === "cancel_response")
          return modifiedValue;
      }
    }

    // Apply request-specific catch-all middleware if this is a request
    if (isRequest && middlewares["request/*"]) {
      const catchAll = middlewares["request/*"] as CatchAllMiddlewareFunction;
      modifiedValue = await catchAll(method, params, result);
      logger.trace(
        { method, params, modifiedValue },
        "Applied request-specific catch-all middleware",
      );
      if (modifiedValue.ls_proxy_code === "cancel_response")
        return modifiedValue;
    }

    // Apply notification-specific catch-all middleware if this is a notification
    if (!isRequest && middlewares["notification/*"]) {
      const catchAll = middlewares[
        "notification/*"
      ] as CatchAllMiddlewareFunction;
      modifiedValue = await catchAll(method, params, result);
      logger.trace(
        { method, params, modifiedValue },
        "Applied notification-specific catch-all middleware",
      );
      if (modifiedValue.ls_proxy_code === "cancel_response")
        return modifiedValue;
    }

    // Apply global catch-all middleware if available
    if (middlewares["*"]) {
      const catchAll = middlewares["*"] as CatchAllMiddlewareFunction;
      modifiedValue = await catchAll(method, params, result);
      logger.trace(
        { method, params, modifiedValue },
        "Applied catch-all middleware",
      );
      if (modifiedValue.ls_proxy_code === "cancel_response")
        return modifiedValue;
    }

    return modifiedValue;
  }

  private async applyHandler<
    T extends LSPProxyClientToProcHandlers | LSPProxyProcToClientHandlers,
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary params for handler
  >(method: string, params: any, handlers: T, isRequest = false): Promise<any> {
    let handlerResult = null;

    // Check for exact method match first
    const exactMatch = handlers[method];
    if (exactMatch) {
      // We can simplify this by checking if the function is a HandlerFunction or CatchAllHandlerFunction
      // based on parameter inspection
      if (exactMatch.length <= 1) {
        // Regular handler function (takes only params)
        handlerResult = await (exactMatch as HandlerFunction)(params);
        logger.trace(
          { method, params, handlerResult },
          "Applied exact method handler",
        );
        if (
          hasALsProxyCode(handlerResult) &&
          handlerResult.ls_proxy_code === "cancel_response"
        ) {
          return handlerResult;
        }
      } else {
        // Catch-all handler function (takes method and params)
        handlerResult = await (exactMatch as CatchAllHandlerFunction)(
          method,
          params,
        );
        logger.trace(
          { method, params, handlerResult },
          "Applied exact method catch-all handler",
        );
        if (
          hasALsProxyCode(handlerResult) &&
          handlerResult.ls_proxy_code === "cancel_response"
        ) {
          return handlerResult;
        }
      }
    }

    // Request-specific catch-all if this is a request
    if (isRequest && handlers["request/*"]) {
      const catchAll = handlers["request/*"] as CatchAllHandlerFunction;
      handlerResult = await catchAll(method, params);
      logger.trace(
        { method, params, handlerResult },
        "Applied request-specific catch-all handler",
      );
      if (
        hasALsProxyCode(handlerResult) &&
        handlerResult.ls_proxy_code === "cancel_response"
      ) {
        return handlerResult;
      }
    }

    // Notification-specific catch-all if this is a notification
    if (!isRequest && handlers["notification/*"]) {
      const catchAll = handlers["notification/*"] as CatchAllHandlerFunction;
      handlerResult = await catchAll(method, params);
      logger.trace(
        { method, params, handlerResult },
        "Applied notification-specific catch-all handler",
      );
      if (
        hasALsProxyCode(handlerResult) &&
        handlerResult.ls_proxy_code === "cancel_response"
      ) {
        return handlerResult;
      }
    }

    // Try global catch-all handler if available
    if (handlers["*"]) {
      const catchAll = handlers["*"] as CatchAllHandlerFunction;
      handlerResult = await catchAll(method, params);
      logger.trace(
        { method, params, handlerResult },
        "Applied global catch-all handler",
      );
      if (
        hasALsProxyCode(handlerResult) &&
        handlerResult.ls_proxy_code === "cancel_response"
      ) {
        return handlerResult;
      }
    }

    // Return null if no handler processed the method
    return handlerResult;
  }
}
