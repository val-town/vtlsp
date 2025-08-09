import { LSPProxy } from "./LSPProxy/LSPProxy.ts";
import { logger } from "../logger.ts";
import { URI } from "vscode-uri";
import { $ } from "execa";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import xdg from "@404wolf/xdg-portable"
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
  EnvVarsNotification,
  PingParams,
  ReadFileParams,
  ReadFileResult,
  ReinitFilesNotification,
} from "./types.d.ts";
import {
  CreateFile,
  DeleteFile,
  type Diagnostic,
  type InitializeResult,
  RenameFile,
  TextDocumentEdit,
} from "vscode-languageserver-protocol";
import { freemem, totalmem } from "node:os";
import { calculateReinitFiles } from "./utils/reinitFiles.ts";
import { getYouShouldUseEsmShDiagnostic } from "./utils/diagnostics/useEsmShInstead.ts";
import { cacheFolderFilesDeps } from "./utils/cacheFolderFilesDeps.ts";
import { defaultDenoJsonConfig } from "./utils/denoConfig.ts";
import { getJsxDiagnostics } from "./utils/diagnostics/jsxDiagnostics.ts";
import { createEnvVarInjection } from "./utils/envVarInjection.ts";
import { pathIsLowerThan } from "./utils/pathIsLowerThan.ts";
import { getRealUri, getVirtualUri } from "./utils/getRealAndVirtualUri.ts";
import { extractReflexiveDiagnostics } from "./utils/diagnostics/reflexiveDiagnostics.ts";

export class VTLSP {
  proxy: LSPProxy;

  #pendingCacheRequests: Set<string> = new Set();
  #resolvedCacheRequests: Set<string> = new Set();
  #envVarFileVersion: number = 0;
  #documentMap: Map<string, TextDocument> = new Map();
  #protectedFilePaths: Set<string> = new Set(["deno.json", "env-vars.ts"]);

  /** A cached "initialize" request response */
  #cachedInitResponse: InitializeResult | null = null;

  /** Whether the client responded with "initialized" */
  #sentInitializeMessage = false;

  /** Promise that resolves when the LSP is initialized */
  #initializePromise: Promise<InitializeResult>;
  #resolveInitializePromise!: (value: InitializeResult) => void;

  get DENO_DIR() {
    return Deno.env.get("DENO_DIR")!; // Guaranteed set in constructor
  }

  constructor({ tempDir }: { tempDir: string }) {
    Deno.env.set("DENO_DIR", Deno.env.get("DENO_DIR") ?? join(xdg.cache(), ".deno"));

    // Create the initialize promise
    this.#initializePromise = new Promise<InitializeResult>((resolve) => {
      this.#resolveInitializePromise = resolve;
    });

    const lsLogStderrPath = resolve("denols-stderr.log");
    const lsLogStdoutPath = resolve("denols-stdout.log");

    this.proxy = new LSPProxy({
      lsLogStderrPath,
      lsLogStdoutPath,
      name: "vtlsp",
      tempDir,
      exec: {
        command: "deno",
        args: ["lsp", "-q"],
        // We want to spawn deno with access to the user's private modules
        env: () => {
          const envDefaults: Record<string, string> = {
            "DENO_DIR": this.DENO_DIR,
            "RUST_BACKTRACE": "1",
          };

          return {
            ...envDefaults,
            ...Deno.env.toObject(),
          };
        },
        callbacks: {
          preSpawn: async () => {
            await Promise.all(
              defaultDenoJsonConfig.compilerOptions.types.map(async (uri) => {
                const valTownTypesStdout = await $("deno", ["cache", "-I", uri]);
                logger.debug({ valTownTypesStdout }, `Cached deno json type for uri: ${uri}`);
              }),
            );
            await this.#setFileContent(
              "deno.json",
              JSON.stringify(defaultDenoJsonConfig, null, 2),
            );
          },
          postSpawn: () => {
            logger.debug("DenoLS process spawned successfully");
          },
          onExit: async (code) => {
            logger.info({ code }, "DenoLS process exited, exiting proxy too");

            const { stdout: logStdoutTail } = await $("tail", [
              "-n",
              Deno.env.get("CRASH_LOG_LINE_COUNT") ?? "1000",
              "denols-stdout.log",
            ]);
            const { stdout: logStderrTail } = await $("tail", [
              "-n",
              Deno.env.get("CRASH_LOG_LINE_COUNT") ?? "1000",
              lsLogStderrPath,
            ]);

            const crashReport = [
              "=== VTLSP LSP Crash Report ===",
              `Exit code: ${code}`,
              "Last 1,000 lines of stdout:",
              logStdoutTail,
              "Last 1,000 lines of stderr:",
              logStderrTail,
              "=== End of VTLSP LSP Crash Report ===",
            ].join("\n");
            console.error(crashReport);

            Deno.exit(code ?? 0);
          },
        },
      },
      procToClientMiddlewares: {
        "initialize": (result) => {
          if (result?.serverInfo?.name) {
            result.serverInfo.name += " (proxied via VTLSP)";
          }

          return result;
        },
        "textDocument/codeAction": (result, params) => {
          logger.debug(
            { uri: params?.textDocument.uri, actions: result?.length, resultType: typeof result },
            "Received code actions from LSP",
          );

          // Ensure result is an array before filtering
          const actions = Array.isArray(result) ? result : [];

          logger.debug(
            { actionsCount: actions },
            "Filtering code actions to remove multi-file actions",
          );

          // Initialize an empty array for our custom actions
          const finalActions = actions
            .filter((action) => {
              if ("kind" in action) {
                // Log the action for debugging
                logger.debug(
                  { actionTitle: action.title, actionKind: action.kind },
                  "Filtering code action",
                );

                // Some code actions already contain the edit field, others need
                // to be lazy-resolved at the time of application, and we don't
                // want to do that now since that's expensive.
                if (action.edit?.documentChanges) {
                  // Filter out multi-file changes - only keep single file edits
                  const isMultiFile = new Set(action.edit.documentChanges
                    .map((c) => {
                      if (CreateFile.is(c) || DeleteFile.is(c)) return c.uri;
                      if (TextDocumentEdit.is(c)) return c.textDocument.uri;
                      if (RenameFile.is(c)) return c.oldUri;
                    })).size > 1;

                  if (isMultiFile) {
                    logger.debug(
                      { action: action.title, documentChanges: action.edit.documentChanges.length },
                      "Filtering out multi-file code action",
                    );
                    return false;
                  }
                }

                // Check known multi-file code actions by kind
                if (action.kind) {
                  if (
                    action.kind.startsWith("refactor.move.") ||
                    action.kind.startsWith("refactor.extract.") ||
                    action.kind.startsWith("source.organizeImports.") ||
                    action.kind === "refactor.rename.project"
                  ) {
                    logger.debug(
                      { action: action.title, kind: action.kind },
                      "Filtering out known multi-file code action by kind",
                    );
                    return false;
                  }
                }
              } else {
                logger.debug(
                  { action: action.title },
                  "Found a command code action, skipping filtering",
                );
              }

              // If we miss any then the user may see the multi file code action, but they'll
              // be given a warning if they try applying it.
              return true;
            });

          // For all the actions, append reflexive diagnostics from each action
          const diagnosticsInParams = extractReflexiveDiagnostics(params?.context.diagnostics || []);
          finalActions.push(...diagnosticsInParams);

          return finalActions;
        },
        "textDocument/publishDiagnostics": async (params) => {
          // Don't process diagnostics for ./env-vars.ts
          if (params.uri.endsWith("env-vars.ts")) {
            logger.debug(
              { uri: params.uri },
              "Skipping diagnostics for env-vars.ts or deno.json",
            );

            return {
              ...params,
              ls_proxy_code: "cancel_response",
            };
          }

          // Find diagnostics that indicate uncached dependencies
          const uncachedDiagnostics = params.diagnostics
            .filter((diagnostic: Diagnostic) => {
              logger.trace(
                { diagnosticCode: diagnostic.code, diagnosticData: diagnostic.data },
                "Checking diagnostic for uncached dependencies",
              );
              return (diagnostic.code === "no-cache" ||
                diagnostic.code === "not-installed-npm" ||
                diagnostic.code === "not-installed-jsr") &&
                diagnostic.data?.specifier;
            })
            .filter((diagnostic: Diagnostic) => {
              const specifier = diagnostic.data?.specifier;
              if (!specifier) {
                logger.debug("Diagnostic has no specifier, filtering out");
                return false;
              }

              // Check if this specifier is already being cached
              const isPending = this.#pendingCacheRequests.has(specifier);
              logger.trace(
                { specifier, isPending },
                "Checking if specifier is already being cached",
              );

              if (!isPending) {
                this.#pendingCacheRequests.add(specifier);
                logger.debug(
                  { specifier },
                  "Added specifier to pending cache requests",
                );
              }

              return !isPending;
            });

          // If there are uncached diagnostics, execute the cache command
          if (uncachedDiagnostics.length > 0) {
            logger.debug(
              { uncachedDiagnostics },
              "Executing deno.cache command for uncached diagnostics",
            );

            // Extract the URLs directly from diagnostic data
            const uncachedDiagnosticUris = uncachedDiagnostics
              .map((diagnostic: Diagnostic) => diagnostic.data?.specifier)
              .filter(Boolean)
              // Deno gives us encoded URIs, but this command expects decoded ones.
              // This is a very frustrating undocumented quirk
              .map(decodeURIComponent) as string[];

            logger.debug(
              { uncachedDiagnosticUris, uri: params.uri },
              "Executing deno.cache command for uncached diagnostics",
            );

            // Execute the deno.cache command with the correct argument format
            // Note: This ONLY works if builtinCommands are enabled during init handshake
            uncachedDiagnosticUris.forEach((uri) => this.#resolvedCacheRequests.add(uri));
            const resp = await this.proxy.procConn!.sendRequest(
              "workspace/executeCommand",
              { // Undocumented command
                command: "deno.cache",
                arguments: [
                  uncachedDiagnosticUris,
                  this.#getRealUri(params.uri),
                ],
              },
            );
            logger.debug(resp, "Executed deno.cache command");
          } else {
            logger.debug({ uri: params.uri }, "No uncached diagnostics found");
          }

          const jsxPragmaDiagnostics = getJsxDiagnostics(
            await this.#getFileContent(params.uri) || "",
            params.uri,
          );
          params.diagnostics.push(...jsxPragmaDiagnostics);

          const esmShDiagnostics = getYouShouldUseEsmShDiagnostic(params.diagnostics);
          params.diagnostics.push(...esmShDiagnostics);

          return params;
        },
      },
      clientToProcMiddlewares: {
        "*": async (_method: unknown, params: unknown) => {
          // Ensure the LSP process is running before forwarding any message
          await this.proxy.processRunningPromise;
          logger.debug(
            { method: _method },
            "After clientToProc '*' middleware: Ensured process is running",
          );
          return params;
        },
        "initialized": (params) => {
          // After initialization, send workspace configuration
          setTimeout(() => {
            this.proxy.procConn?.sendNotification("workspace/didChangeConfiguration", {
              settings: {
                deno: {
                  enable: true,
                  config: this.#getRealUri("deno.json"),
                  importMap: null,
                  codeLens: {
                    implementations: true,
                    references: true,
                  },
                },
              },
            });
            logger.debug("Sent workspace configuration to LSP");
          }, 100);

          this.#sentInitializeMessage = true;
          logger.debug("After clientToProc middleware: initialized");
          return params;
        },
        "textDocument/didOpen": async (params) => {
          if (URI.parse(params.textDocument.uri).scheme !== "file") {
            return params;
          }

          if (pathIsLowerThan(params.textDocument.uri, this.DENO_DIR)) {
            return params;
          }

          logger.debug(
            { uri: params.textDocument.uri },
            "Opening text document on fs",
          );

          const document = TextDocument.create(
            params.textDocument.uri,
            params.textDocument.languageId,
            params.textDocument.version,
            params.textDocument.text,
          );
          this.#documentMap.set(params.textDocument.uri, document);

          await this.#setFileContent(params.textDocument.uri, params.textDocument.text);

          logger.debug(
            { uri: params.textDocument.uri },
            "After clientToProc middleware: textDocument/didOpen",
          );
          return params;
        },
        "textDocument/didChange": async (params) => {
          if (URI.parse(params.textDocument.uri).scheme !== "file") {
            return params;
          }

          logger.debug(
            { uri: params.textDocument.uri },
            "Changing text document on fs",
          );

          // Get existing document from map or create new one
          let document = this.#documentMap.get(params.textDocument.uri);
          if (!document) {
            const currentText = await this.#getFileContent(
              params.textDocument.uri,
            );
            document = TextDocument.create(
              params.textDocument.uri,
              "typescript",
              params.textDocument.version - 1,
              currentText || "",
            );
          }

          // Apply changes and update document map
          const updatedDocument = TextDocument.update(
            document,
            params.contentChanges,
            params.textDocument.version,
          );

          await this.#setFileContent(params.textDocument.uri, updatedDocument.getText());

          logger.debug(
            { uri: params.textDocument.uri, version: params.textDocument.version },
            "After clientToProc middleware: textDocument/didChange",
          );
          return params;
        },
        "textDocument/didClose": (params) => {
          if (URI.parse(params.textDocument.uri).scheme !== "file") {
            return params;
          }

          logger.debug(
            { uri: params.textDocument.uri },
            "Closing text document",
          );

          this.#documentMap.delete(params.textDocument.uri);

          logger.debug(
            { uri: params.textDocument.uri },
            "After clientToProc middleware: textDocument/didClose",
          );
          return params;
        },
      },
      clientToProcHandlers: {
        "initialized": () => {
          if (this.#sentInitializeMessage) {
            logger.debug("Initialized message already sent, ignoring duplicate");
            return; // Don't propagate to LSP
          }

          this.#sentInitializeMessage = true;
          logger.debug("Setting sentInitializedMessage to true");
          const result = this.proxy.procConn!.sendNotification("initialized", {});
          logger.debug("After clientToProc handler: initialized");
          return result; // Propagate to LSP
        },
        "initialize": async (params) => {
          if (params.initializationOptions?.apiKey) {
            const esmTownHostname = Deno.env.get("ESM_TOWN_HOSTNAME") || "module.localhost:3001";
            Deno.env.set("DENO_AUTH_TOKENS", `${params.initializationOptions.apiKey}@${esmTownHostname}`);
          }

          // Wait for the DenoLS process to be running before proceeding
          await this.proxy.processRunningPromise;

          if (this.#cachedInitResponse) {
            logger.debug("Returning cached initialize response");
            return this.#cachedInitResponse;
          } else {
            // Set the workspace folder to the temp dir
            params.workspaceFolders = [{
              uri: URI.from({ scheme: "file", path: this.proxy.tempDir })
                .toString(),
              name: crypto.randomUUID(),
            }];

            // Add the enableBuiltinCommands flag to initialization options
            params.initializationOptions = {
              ...params.initializationOptions,
              maxTsServerMemory: totalmem() * 0.85,
              enableBuiltinCommands: true,
              cacheOnSave: true,
              config: this.#getRealUri("deno.json"),
            };

            const result = await this.proxy.sendRequest("initialize", params);
            if (!result) {
              throw new Error("Failed to initialize LSP");
            }
            this.#cachedInitResponse = result;
            // Resolve the initialize promise
            this.#resolveInitializePromise(result);
            logger.debug(
              { capabilities: Object.keys(result.capabilities || {}) },
              "After clientToProc handler: initialize",
            );
            return result;
          }
        },
        "vtlsp/ping": (_params: PingParams) => {
          const response = {
            status: "pong",
            stats: {
              totalMemory: totalmem(),
              freeMemory: freemem(),
            },
          };
          logger.debug(
            { stats: response.stats },
            "After clientToProc handler: vtlsp/ping",
          );
          return response;
        },
        "vtlsp/envVars": async (params: EnvVarsNotification) => {
          logger.debug({ envVars: params.envVars }, "Updating env vars in LSP");

          await this.#initializePromise.then(() => {
            const envVarFile = createEnvVarInjection(params.envVars);

            // Send didOpen notification to LSP for the env vars file.
            // We'd like to put them in the types field for the deno.json but it seems like
            // deno doesn't like that being dynamic.
            this.proxy.procConn!.sendNotification("textDocument/didOpen", {
              textDocument: {
                uri: this.#getRealUri("env-vars.ts"),
                languageId: "typescript",
                version: ++this.#envVarFileVersion,
                text: envVarFile,
              },
            });
          });

          logger.debug(
            { envVarsCount: Object.keys(params.envVars || {}).length },
            "After clientToProc handler: vtlsp/envVars",
          );
          return {};
        },
        "vtlsp/readFile": async (
          params: ReadFileParams,
        ): Promise<ReadFileResult> => {
          const result: ReadFileResult = {};

          logger.debug(
            { uri: params.textDocument.uri },
            "Reading file content from LSP",
          );

          const uri = URI.parse(params.textDocument.uri);
          if (uri.scheme !== "file") {
            logger.warn(
              { uri: params.textDocument.uri },
              "Attempted to read a non-file URI, returning null",
            );
            return result;
          }

          if (!pathIsLowerThan(uri.fsPath, this.DENO_DIR)) {
            return result;
          }

          // We allow reading from either the temp directory or the
          // /app/.deno_dir directory
          try {
            result.text = await this.#getFileContent(params.textDocument.uri) ??
              await Deno.readTextFile(fromFileUrl(uri.toString()));
          } catch (error) {
            logger.error(
              { uri: params.textDocument.uri, error },
              "Failed to read file content",
            );
            if (!(error instanceof Deno.errors.NotFound)) return result; // Return empty result on error
          }

          logger.debug(
            { uri: params.textDocument.uri, hasContent: !!result.text },
            "After clientToProc handler: vtlsp/readFile",
          );
          return result;
        },
        "vtlsp/reinitFiles": async (params: ReinitFilesNotification) => {
          logger.debug(
            { files: params.files.length },
            "Received vtlsp/reinitFiles notification",
          );

          const result = await calculateReinitFiles(params.files, {
            tempDir: this.proxy.tempDir,
            protectedFiles: this.#protectedFilePaths,
            getFileContent: this.#getFileContent.bind(this),
          });

          // Now commit the changes, and update our state
          for (const file of result.deletedFiles) {
            logger.debug({ file }, "Deleting file in LSP temp dir");
            await this.#deleteFile(file);
          }

          await Promise.all(
            result.createdFiles.concat(result.changedFiles).map(async (file) => {
              logger.debug({ file }, "Creating file in LSP temp dir");
              const content = params.files
                .find((candidate) => fromFileUrl(candidate.uri) === file)!
                .text;

              await this.#setFileContent(file, content);
            }),
          );

          // Notify the LSP
          if (result.fileEvents.length > 0) {
            this.proxy.sendNotification("workspace/didChangeWatchedFiles", {
              changes: result.fileEvents,
            });
            logger.debug(
              { changes: result.fileEvents },
              "Sent workspace/didChangeWatchedFiles notification",
            );
          }

          // Cache the subdependencies of all files in the workspace.
          await cacheFolderFilesDeps(this.proxy.tempDir);

          // Send didSave notifications for all created and changed files
          // For some reason this is needed to get proper type inferences for files that
          // the user does NOT open but does import, that import dependencies.
          //
          // If foo.ts imports npm:bar, and uses it, and exports a bar=new
          // Bar() instance, and buzz.ts imports bar from foo.ts, then bar
          // is an any unless we send a didSave notification at least once.
          // Unsure why this "black magic" works :/, just trial+error.
          await Promise.all(
            result.createdFiles.concat(result.changedFiles).map(async (file) => {
              const virtualUri = this.#getVirtualUri(file);
              await this.proxy.procConn?.sendNotification("textDocument/didSave", {
                textDocument: { uri: this.#getRealUri(virtualUri) },
              });
              logger.debug({ file, virtualUri }, "Sent textDocument/didSave notification");
            }),
          );
          ;

          await this.proxy.clientConn.sendNotification("vtlsp/didFinishCaching", {});

          logger.debug(
            { filesCount: params.files.length },
            "After clientToProc handler: vtlsp/reinitFiles",
          );

          // Check if deno.json is included in the new files, and if not,
          // write our default backup
          if (!(await exists(this.#getRealUri("deno.json")!))) {
            logger.debug("deno.json not included in reinitFiles, writing default backup");
            this.#setFileContent(
              "deno.json",
              JSON.stringify(defaultDenoJsonConfig, null, 2),
            );
          }

          return {};
        },
      },
      uriConverters: {
        // Convert from LSP URI to editor URI (temp path to fake path)
        fromProcUri: (uriString: string) => {
          const parsedUri = URI.parse(uriString);
          if (parsedUri.path.startsWith(this.DENO_DIR)) return uriString;

          const converted = this.#getVirtualUri(uriString);
          logger.debug(
            { uri: uriString, converted },
            "Converted LSP URI to editor URI",
          );
          return converted;
        },

        // Convert from editor URI to LSP URI (fake path to temp path)
        toProcUri: (uriString: string) => {
          const parsedUri = URI.parse(uriString);
          if (parsedUri.path.includes(this.DENO_DIR)) return uriString;

          const converted = this.#getRealUri(uriString);
          const converted2 = this.#getVirtualUri(uriString);
          logger.warn(
            { uri: uriString, converted, converted2 },
            "TWO OPTIONS",
          );
          if (!converted) {
            logger.error(
              { uri: uriString },
              "No valid temp file URI found for conversion",
            );
            throw new Error(`No valid temp file URI found for conversion: ${uriString}`);
          }

          logger.debug(
            { uri: uriString, converted },
            "Converted editor URI to LSP URI",
          );
          return converted;
        },
      },
    });
  }

  public async listen() {
    await this.proxy.listen();
  }

  /**
   * Get the content of a file from its URI.
   *
   * Silently ignores attempts to read files outside the temp directory.
   * This also abstracts IO in case we eventually do it all in memory.
   *
   * @param path The URI of the file to read
   * @returns The content of the file, or undefined if the file does not exist
   *          or is outside the temp directory
   */
  async #getFileContent(path: string): Promise<string | undefined> {
    const fileUri = this.#getRealUri(path);

    if (!fileUri) {
      logger.warn(
        { uri: path },
        "No valid temp file URI found for reading, returning undefined",
      );
      return undefined;
    }

    const filePath = fromFileUrl(fileUri);

    if (!pathIsLowerThan(filePath, this.proxy.tempDir)) {
      logger.warn(
        { uri: path },
        "Attempted to read a file outside the temp directory, returning undefined",
      );
      return undefined;
    }

    logger.debug(
      { uri: path, filePath },
      "Attempting to read file content",
    );

    try {
      const content = await Deno.readTextFile(filePath);
      logger.debug(
        { uri: path, filePath, contentLength: content.length },
        "Successfully read file content",
      );
      return content;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;

      logger.debug(
        { uri: path, filePath, error },
        "File does not exist, returning undefined",
      );
      return undefined;
    }
  }

  /**
   * Set the content of a file at the specified URI.
   *
   * Silently ignores attempts to write files outside the temp directory.
   * This also abstracts IO in case we eventually do it all in memory.
   *
   * @param path The URI of the file to write to
   * @param content The content to write
   * @returns A promise that resolves when the file has been written, or undefined if writing failed
   */
  async #setFileContent(path: string, content: string): Promise<void> {
    const fileUri = this.#getRealUri(path);

    if (!fileUri) {
      logger.warn(
        { uri: path },
        "No valid temp file URI found for writing, ignoring",
      );
      return;
    }

    const filePath = fromFileUrl(fileUri);

    if (!pathIsLowerThan(filePath, this.proxy.tempDir)) {
      logger.warn(
        { uri: path },
        "Attempted to write to a file outside the temp directory, ignoring",
      );
      return;
    }

    logger.debug(
      { uri: path, filePath, contentLength: content.length },
      "Writing file content",
    );

    // Update document map if document exists
    const virtualUri = this.#getVirtualUri(path);
    const existingDoc = this.#documentMap.get(virtualUri);
    if (existingDoc) {
      const updatedDoc = TextDocument.create(
        virtualUri,
        existingDoc.languageId,
        existingDoc.version + 1,
        content,
      );
      this.#documentMap.set(virtualUri, updatedDoc);
      logger.debug(
        { uri: virtualUri, version: updatedDoc.version },
        "Updated document in document map",
      );
    }

    await ensureDir(dirname(filePath));
    await Deno.writeTextFile(filePath, content);
    logger.debug(
      { uri: path, filePath },
      "Successfully wrote file content",
    );
  }

  /**
   * Delete a file at the specified URI.
   *
   * Silently ignores attempts to delete files outside the temp directory or if
   * file didn't exist.
   */
  async #deleteFile(path: string): Promise<void> {
    const fileUri = this.#getRealUri(path);

    if (!fileUri) {
      logger.warn(
        { uri: path },
        "No valid temp file URI found for deletion, ignoring",
      );
      return;
    }

    const filePath = fromFileUrl(fileUri);

    if (!pathIsLowerThan(filePath, this.proxy.tempDir)) {
      logger.warn(
        { uri: path },
        "Attempted to delete a file outside the temp directory, ignoring",
      );
      return;
    }

    try {
      await Deno.remove(filePath, { recursive: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.warn(
          { uri: path },
          "Attempted to delete a file that does not exist, ignoring",
        );
        return;
      } else throw error;
    }

    this.#documentMap.delete(this.#getVirtualUri(path));
  }

  #getRealUri(pathOrUri: string): string | undefined {
    return getRealUri(pathOrUri, this.proxy.tempDir);
  }

  #getVirtualUri(pathOrUri: string): string {
    return getVirtualUri(pathOrUri, this.proxy.tempDir);
  }
}
