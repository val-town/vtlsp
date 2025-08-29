import process from "node:process";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { WebSocket } from "isows";
import { isJSONRPCRequest, isJSONRPCResponse } from "json-rpc-2.0";
import { pipeLsInToLsOut } from "~/LSWSServer/LSTransform.js";
import type { LSProc } from "~/LSWSServer/procs/LSProc.js";
import { LSProcManager } from "~/LSWSServer/procs/LSProcManager.js";
import { createWebSocketStreams } from "~/LSWSServer/WSStream.js";
import { defaultLogger, type Logger } from "~/logger.js";

interface ConnectionData {
  /**
   * Consumer stream for the LSP process output.
   *
   * This is a PassThrough stream for this connection that reads from the
   * multicast stream of the LSP process's stdout.
   */
  procOutConsumer: PassThrough;

  /**
   * Map of UUID request IDs to their original numerical IDs.
   */
  requestIDTranslationMap: Map<string, number>;
}

interface LSWSServerSessionData {
  conns: Map<WebSocket, ConnectionData>;
  proc: LSProc;
  createProcOutConsumer: () => PassThrough;
  createStdinProducer: () => PassThrough;
}

export interface LSWSServerOptions {
  /** Command to start the LSP process. */
  lsCommand: string;
  /** Arguments to pass to the LSP command. */
  lsArgs: string[];
  /** Path to log LSP stdout output to. **/
  lsStdoutLogPath?: string;
  /** Path to log LSP stderr output to. **/
  lsStderrLogPath?: string;
  /**
   * Maximum number of LSP processes to run concurrently.
   *
   * Every new session will spawn a new LSP process, up to this limit. If
   * additional sessions are requested, the server will wait kill the oldest
   * sessions up until there is room for the new session under this limit.
   *
   * If -1, there is no limit on the number of processes.
   *
   * @default 3
   */
  maxProcs?: number;
  /**
   * Maximum number of concurrent connections per session.
   *
   * If not provided, there is no limit on the number of connections per session.
   */
  maxSessionConns?: number;
  /** Maximum message size for stream processing (in bytes). */
  maxMessageSize?: number;
  /**
   * Shutdown after this many seconds of inactivity.
   *
   * If not provided, the server will not automatically shut down.
   */
  shutdownAfter?: number;
  /** Callback for when an LSP process encounters an error.  */
  onProcError?: (sessionId: string, error: Error) => void;
  /** Callback for when an LSP process exits. */
  onProcExit?: (sessionId: string, code: number | null) => void;
  /** Logger instance to use for logging. */
  logger?: Logger;
}

/**
 * LSWSServer is a WebSocket server for managing Language Server Protocol (LSP)
 * processes with associated sessions.
 *
 * Every language server process that gets spawned by this class corresponds to
 * some unique session ID.  When someone connects to the server, if they are
 * re-joining and use the same session ID as a previous connection, they will
 * be reconnected to the same LSP process.
 *
 * If many people connect to the same session ID, they will all share the same
 * LSP process and its associated streams. All messages will go to the LSP, but
 * responses for requests that some specific WebSocket sent will be responded to
 * directly. Notifications from the language server will be broadcast to all.
 *
 * When a new WebSocket connection is received:
 * - handleNewWebsocket() is called with the WebSocket and session ID.
 * - If the session already exists, it reuses the existing LSP process and multicast.
 * - If the session does not exist, it creates a new LSP process and multicast streams.
 * - Each WebSocket gets its own consumer streams from the multicast.
 * - The WebSocket connection is registered in the session's connection map.
 * - When the WebSocket closes, it deregisters the consumer and cleans up streams.
 *
 * This class acts as a manager for sessions and LSP processes, and
 * intentionally does no actually handle any requests or responses itself. We
 * simply take any WebSocket that conforms to the WebSocket API, and wire it
 * based on its session ID when it "joins" the pool.
 *
 * Note that once this class has been fed a WebSocket, you shouldn't try to use
 * that WebSocket elsewhere or for other purposes.
 */
export class LSWSServer {
  public readonly lsProcManager: LSProcManager;
  public acceptingConnections = true;
  private readonly logger: Logger;

  private sessionMap = new Map<string, LSWSServerSessionData>();
  private maxSessionConns?: number;
  private shutdownTimeoutId?: NodeJS.Timeout;
  private maxMessageSize?: number;

  public shutdownAfter?: number;

  public onProcError?: (sessionId: string, error: Error) => void;
  public onProcExit?: (sessionId: string, code: number | null) => void;

  constructor({
    lsCommand,
    lsArgs,
    lsStdoutLogPath,
    lsStderrLogPath,
    maxProcs = 3,
    maxMessageSize = 500 * 1024, // 500 KB
    maxSessionConns,
    shutdownAfter,
    onProcError,
    onProcExit,
    logger = defaultLogger,
  }: LSWSServerOptions) {
    this.logger = logger;

    this.logger.info(
      `Initializing LSWSServer with command: ${lsCommand} ${lsArgs.join(" ")}`,
    );
    this.logger.info(
      `Log path: ${lsStdoutLogPath}, Max processes: ${maxProcs || "unlimited"}`,
    );

    this.onProcError = onProcError;
    this.onProcExit = onProcExit;
    this.shutdownAfter = shutdownAfter;
    this.maxMessageSize = maxMessageSize;

    this.lsProcManager = new LSProcManager({
      lsStdoutLogPath,
      lsStderrLogPath,
      lsCommand,
      lsArgs,
      maxProcs,
      logger,
      onProcError: (sessionId: string, error: Error): void => {
        this.logger.error(
          { sessionId, error: error.stack || error.message },
          `LSP process error for session ${sessionId}: ${error.message}`,
        );

        this.onProcError?.(sessionId, error);
      },
      onProcExit: async (sessionId, code, signal, proc): Promise<void> => {
        const logLineCount = Number.parseInt(
          process.env.CRASH_LOG_LINE_COUNT ?? "1000",
        );

        // biome-ignore lint/suspicious/noConsole: for crash reporting
        console.error(
          { sessionId, exitCode: code, signal },
          `LSP process for session ${sessionId} exited with code ${code}`,
        );

        const [lastLogsStdout, lastLogsStderr] = await proc.getLogTail(
          logLineCount,
        );

        const crashReport = "=== LSP Exit Report ===\n" +
          `Session ID: ${sessionId}\n` +
          `Exit code: ${code}\n` +
          `LSP command: ${lsCommand} ${lsArgs.join(" ")}\n` +
          `Last ${logLineCount} lines of stdout:\n${lastLogsStdout}\n` +
          `Last ${logLineCount} lines of stderr:\n${lastLogsStderr}\n` +
          "=== End of Exit Report ===\n";

        // biome-ignore lint/suspicious/noConsole: for crash reporting
        console.error(crashReport);

        if (
          process.env.EXIT_ON_LS_BAD_EXIT === "1" &&
          this.sessionMap.has(sessionId) &&
          code !== null &&
          code !== 0
        ) {
          // If the session map doesn't have the proc that means we manually killed it
          process.exit(code);
        }

        // Close the session immediately when the process exits
        await this.closeSession(
          sessionId,
          1012,
          `LSP process exited (code ${code})`,
        );
        this.onProcExit?.(sessionId, code);
      },
    });

    this.maxSessionConns = maxSessionConns;

    this.logger.info({}, "LSWSServer initialized successfully");
  }

  public handleNewWebsocket(socket: WebSocket, sessionId: string) {
    if (!this.acceptingConnections) {
      this.logger.warn(
        { sessionId },
        "New WebSocket connection request rejected",
      );
      return new Response("Server is not accepting new connections", {
        status: 503,
      });
    }

    this.logger.info(
      { sessionId },
      "New WebSocket connection request for session",
    );

    let proc: LSProc;
    let sessionData = this.sessionMap.get(sessionId);

    // Check if we're reconnecting to an existing session
    if (sessionData?.proc.pid) {
      // Ensure we don't exceed the maximum connections per session to prevent event
      // listener leaks
      this.#enforceMaxConnsPerSession(sessionData, sessionId);

      // Reuse existing process and multicast
      proc = sessionData.proc;
      this.logger.info(
        { sessionId, pid: proc.pid },
        "Reconnecting to existing LSP process for session",
      );
    } else {
      this.logger.info(
        { sessionId },
        `Creating new LSP process for session ${sessionId}`,
      );
      proc = this.lsProcManager.getOrCreateProc(sessionId);
      this.logger.info(
        { sessionId, pid: proc.pid },
        `Created LSP process with PID ${proc.pid} for session ${sessionId}`,
      );

      if (!proc.stdout || !proc.stdin) {
        this.logger.error(
          { sessionId },
          "Failed to create LSP process streams",
        );
        return new Response("Failed to create LSP process streams", {
          status: 500,
        });
      }

      // Create multicast stream for the new process stdout only
      const createProcOutConsumer = this.#createNewMulticastStream(proc.stdout);

      // Create singlecast stream for stdin handling (many-to-one)
      const createStdinProducer = this.#createNewSinglecastStream(proc.stdin);

      // Set the maxEventListeners for stdout and stdin based on this.maxSessionConns
      if (this.maxSessionConns) {
        proc.stdout.setMaxListeners(this.maxSessionConns + 1); // +1 for the initial consumer
        proc.stdin.setMaxListeners(this.maxSessionConns + 1);
      }

      sessionData = {
        conns: new Map(),
        proc,
        createProcOutConsumer,
        createStdinProducer,
      };
      this.sessionMap.set(sessionId, sessionData);
    }

    if (!sessionData.createProcOutConsumer) {
      this.logger.error(
        { sessionId },
        "Failed to access multicast streams for LSP process",
      );
      return new Response("Failed to create LSP process streams", {
        status: 500,
      });
    }

    this.logger.debug({ sessionId }, "WebSocket upgraded successfully");

    this.#setupShutdownHandling(socket);

    socket.addEventListener("error", (event) => {
      this.logger.error(
        { sessionId, event },
        `WebSocket error for session ${sessionId}`,
      );
      this.#closeWebSocket(socket, sessionId, 1011, "WebSocket error occurred");
    });

    const { readable: webSocketIn, writable: webSocketOut } =
      createWebSocketStreams(socket, { chunkSize: this.maxMessageSize });

    // Register new proxies for this WebSocket
    const procOutConsumer = sessionData.createProcOutConsumer();
    const stdinProducer = sessionData.createStdinProducer();

    // Register this connection with its consumer
    const connData: ConnectionData = {
      procOutConsumer,
      requestIDTranslationMap: new Map(),
    };
    sessionData.conns.set(socket, connData);

    try {
      // Connect the process output consumer to this WebSocket's output with connection-specific middleware
      pipeLsInToLsOut(
        procOutConsumer,
        webSocketOut,
        this.#createConnectionOutMiddleware(connData),
      );

      // Connect the WebSocket input to the stdin producer through connection-specific middleware
      pipeLsInToLsOut(
        webSocketIn,
        stdinProducer,
        this.#createInboundMiddleware(connData),
      );

      // Set up error handling for the streams
      procOutConsumer.on("error", (error) => {
        this.logger.error(
          { sessionId, error: error.stack || error.message },
          "Process output consumer error",
        );
        this.#closeWebSocket(socket, sessionId, 1011, "Stream error occurred");
      });
      stdinProducer.on("error", (error) => {
        this.logger.error(
          { sessionId, error: error.stack || error.message },
          "Stdin producer error",
        );
        this.#closeWebSocket(socket, sessionId, 1011, "Stream error occurred");
      });

      // Add error handlers for WebSocket streams to prevent crashes
      webSocketIn.on("error", (error) => {
        this.logger.error(
          { sessionId, error: error.stack || error.message },
          "WebSocket input stream error",
        );
        this.#closeWebSocket(socket, sessionId, 1011, "WebSocket input error");
      });
      webSocketOut.on("error", (error) => {
        this.logger.error(
          { sessionId, error: error.stack || error.message },
          "WebSocket output stream error",
        );
        this.#closeWebSocket(socket, sessionId, 1011, "WebSocket output error");
      });
    } catch (err) {
      if (!(err instanceof Error)) throw new Error(String(err));
      this.logger.error(
        { sessionId, error: err.stack || err.message },
        "Error setting up stream pipes",
      );
      return new Response("Failed to set up WebSocket streams", {
        status: 500,
      });
    }

    socket.onopen = () => {
      this.logger.info(
        { sessionId },
        `WebSocket connection opened for session ${sessionId}`,
      );
    };

    socket.onerror = (event) => {
      this.logger.error(
        { sessionId, event },
        `WebSocket error for session ${sessionId}`,
      );
      this.#closeWebSocket(socket, sessionId, 1011, "WebSocket error occurred");
    };

    socket.onclose = (event) => {
      const connData = sessionData.conns.get(socket);

      this.logger.info(
        {
          sessionId,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        },
        "WebSocket closed for session",
      );

      if (connData) {
        try {
          connData.procOutConsumer.destroy();
          webSocketOut.destroy();
        } catch (err) {
          this.logger.debug(
            { sessionId, error: err },
            "Error during connection cleanup",
          );
        }
        sessionData.conns.delete(socket);
      }
    };

    this.logger.info(
      { sessionId },
      `WebSocket connection established for ${sessionId}`,
    );
  }

  /**
   * Close a session and all its connections.
   *
   * @param sessionId The ID of the session to close.
   * @param code Optional WebSocket close code (default is 1000).
   * @param message Optional close message (default is "Session closed by server").
   */
  public async closeSession(
    sessionId: string,
    code = 1012,
    message = "Session closed by server",
  ): Promise<void> {
    const session = this.sessionMap.get(sessionId);
    if (!session) return;
    this.sessionMap.delete(sessionId);

    this.logger.info(
      { sessionId, code, message },
      `Closing session ${sessionId} with code ${code}: ${message}`,
    );

    for (const [ws, connData] of session.conns) {
      this.logger.debug(
        { sessionId, code, message },
        "Closing WebSocket connection",
      );

      // Close the WebSocket first, before destroying streams
      this.#closeWebSocket(ws, sessionId, code, message);

      try {
        this.logger.trace({ sessionId }, "Destroying consumer streams");
        connData.procOutConsumer.destroy();
      } catch (err) {
        this.logger.debug(
          { sessionId, error: err },
          "Error while closing consumer streams during session close",
        );
      }
    }

    await this.lsProcManager.releaseProc(sessionId);

    this.logger.info({ sessionId }, `Session ${sessionId} closed successfully`);
  }

  /**
   * Shutdown the server and all sessions.
   *
   * This method gracefully closes all sessions and their connections,
   * ensuring that all resources are cleaned up properly.
   *
   * @param code Optional WebSocket close code (default is 1012).
   * @returns A promise that resolves when the server has shut down.
   */
  public async shutdown(code = 1012, message = "Server shutting down") {
    this.acceptingConnections = false;

    this.logger.info("Shutting down LSWSServer and all sessions");

    // Close all sessions gracefully
    for (const sessionId of this.sessionMap.keys()) {
      await this.closeSession(sessionId, code, message);
    }
  }

  #createInboundMiddleware(connData: ConnectionData) {
    return (chunk: string): string | null => {
      try {
        const message = JSON.parse(chunk);

        // Change the inbound message numerical ID to a UUID, and put the UUID in our map
        if (isJSONRPCRequest(message) && typeof message.id === "number") {
          this.logger.debug(
            { messageId: message.id },
            "Processing LSP message with ID",
          );
          const newUuid = crypto.randomUUID();
          connData.requestIDTranslationMap.set(newUuid, message.id);
          message.id = newUuid;
        }

        return JSON.stringify(message);
      } catch (error) {
        this.logger.error(error, "Failed to parse message: ");
        return chunk;
      }
    };
  }

  #createConnectionOutMiddleware(connData: ConnectionData) {
    return (chunk: string): string | null => {
      try {
        const message = JSON.parse(chunk);

        // If the message is a response with a UUID ID, map it back to a numerical ID
        if (isJSONRPCResponse(message) && typeof message.id === "string") {
          this.logger.debug(
            { messageId: message.id },
            "Processing LSP response with ID",
          );

          const originalId = connData.requestIDTranslationMap.get(message.id);
          if (originalId === undefined) {
            this.logger.warn(
              { messageId: message.id },
              "No original numerical ID found for UUID ID in response",
            );
            // Don't send the message if we can't map it. This is probably a
            // response to a request for a different session.
            return null;
          }

          const oldMessageId = message.id;
          message.id = originalId;
          connData.requestIDTranslationMap.delete(oldMessageId);
        }

        return JSON.stringify(message);
      } catch (error) {
        this.logger.error(error, "Failed to parse message");
        return chunk;
      }
    };
  }

  /**
   * Get a factory for streams that will read from the source stream.
   *
   * This creates a multicast stream that allows multiple consumers to read
   * the same data from the source stream.
   *
   * Once the source stream ends or encounters an error, all consumers
   * will be notified, and no new consumers can be created.
   */
  #createNewMulticastStream(sourceStream: Readable): () => PassThrough {
    const consumers = new Set<PassThrough>();
    let isSourceEnded = false;

    sourceStream.on("data", (chunk) => {
      consumers.forEach((consumer) => {
        if (!consumer.destroyed) {
          consumer.write(chunk);
        }
      });
    });

    sourceStream.on("end", () => {
      isSourceEnded = true;
      for (const consumer of consumers) {
        if (!consumer.destroyed) {
          consumer.end();
        }
      }
    });

    sourceStream.on("error", (error) => {
      for (const consumer of consumers) {
        if (!consumer.destroyed) {
          consumer.destroy(error);
        }
      }
    });

    return () => {
      const consumer = new PassThrough();
      consumers.add(consumer);

      if (isSourceEnded && !consumer.destroyed) {
        consumer.end();
      }

      consumer.on("close", () => {
        consumers.delete(consumer);
      });

      return consumer;
    };
  }

  /**
   * Get a factory for streams that will write to the target stream.
   *
   * This creates a singlecast stream that allows multiple producers to write to
   * the same target stream.
   *
   * Once the target stream is closed or encounters an error, all producers
   * will be destroyed with the same error, and no new producers can be created.
   */
  #createNewSinglecastStream(targetStream: Writable): () => PassThrough {
    const producers = new Set<PassThrough>();
    let isTargetDestroyed = false;

    const destroyAllProducers = () => {
      for (const producer of producers) {
        if (!producer.destroyed) {
          producer.destroy();
        }
      }
    };

    targetStream.on("error", (error) => {
      this.logger.error({ error }, "Error in target stream");
      isTargetDestroyed = true;
      destroyAllProducers();
    });

    targetStream.on("close", () => {
      this.logger.info("Target stream closed");
      isTargetDestroyed = true;
      destroyAllProducers();
    });

    const unpipeAndDestroyProducer = (producer: PassThrough) => {
      producer.unpipe(targetStream);
      if (!producer.destroyed) {
        producer.destroy();
      }
      producers.delete(producer);
    };

    return () => {
      const producer = new PassThrough();
      producers.add(producer);

      if (!isTargetDestroyed) {
        producer.pipe(targetStream, { end: false });
      }

      producer.on("error", (error) => {
        this.logger.debug({ error }, "Error in stdin producer stream");
        unpipeAndDestroyProducer(producer);
      });

      producer.on("close", () => {
        unpipeAndDestroyProducer(producer);
      });

      if (isTargetDestroyed && !producer.destroyed) {
        producer.destroy();
      }

      return producer;
    };
  }

  #closeWebSocket(
    socket: WebSocket,
    sessionId: string,
    code: number,
    reason: string,
  ): void {
    try {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        this.logger.debug(
          {
            sessionId,
            code,
            reason,
            readyState: socket.readyState,
          },
          "Attempting to close WebSocket",
        );
        socket.close(code, reason);
      } else {
        this.logger.debug(
          {
            sessionId,
            readyState: socket.readyState,
            attemptedCode: code,
          },
          "WebSocket already closed or closing",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error while closing WebSocket",
      );
    }
  }

  #enforceMaxConnsPerSession(
    sessionData: LSWSServerSessionData,
    sessionId: string,
  ): void {
    if (!this.maxSessionConns) return;

    while (sessionData.conns.size >= this.maxSessionConns) {
      const firstConnection = sessionData.conns.keys().next().value;
      if (firstConnection) {
        this.logger.info(
          {
            sessionId,
            currentConns: sessionData.conns.size,
            maxConns: this.maxSessionConns,
          },
          "Connection limit reached, closing first connection",
        );

        this.#closeWebSocket(
          firstConnection,
          sessionId,
          1000,
          "Connection limit exceeded",
        );
        sessionData.conns.delete(firstConnection);
      } else {
        break;
      }
    }
  }

  #setupShutdownHandling(socket: WebSocket): void {
    const resetShutdownTimeout = () => {
      if (this.shutdownAfter) {
        if (this.shutdownTimeoutId) {
          clearTimeout(this.shutdownTimeoutId);
          this.shutdownTimeoutId = undefined;
        }

        this.shutdownTimeoutId = setTimeout(async () => {
          await this.shutdown(1012, "Server shutting down due to inactivity");
          // biome-ignore lint/suspicious/noConsole: for shutdown logging
          console.error("Shutting down after inactivity");
          process.exit(1);
        }, this.shutdownAfter * 1000);
      }
    };

    resetShutdownTimeout(); // when a new socket is enabled, clear any existing timeout

    const messageHandler = () => {
      resetShutdownTimeout();
    };

    const closeHandler = () => {
      resetShutdownTimeout();
      socket.removeEventListener("message", messageHandler);
      socket.removeEventListener("close", closeHandler);
    };

    socket.addEventListener("message", messageHandler);
    socket.addEventListener("close", closeHandler);
  }
}
