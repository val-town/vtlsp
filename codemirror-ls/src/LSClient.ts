import { Emitter } from "vscode-jsonrpc";
import type * as LSP from "vscode-languageserver-protocol";
import type { LSCore } from "./LSPlugin.js";
import type { LSITransport } from "./transport/LSITransport.js";
import type { LSPNotifyMap, LSPRequestMap } from "./types.lsp.js";

export interface LanguageServerClientOptions {
  /** List of workspace folders to send to the language server */
  workspaceFolders: LSP.WorkspaceFolder[] | null;
  /** Whether to automatically close the connection when the editor is destroyed */
  autoClose?: boolean;
  /**
   * Client capabilities to send to the server during initialization.
   * Can be an object or a function that modifies the default capabilities.
   */
  capabilities?:
    | LSP.InitializeParams["capabilities"]
    | ((
        defaultCapabilities: LSP.InitializeParams["capabilities"],
      ) => LSP.InitializeParams["capabilities"]);
  /** Additional initialization options to send to the language server */
  initializationOptions?: LSP.InitializeParams["initializationOptions"];
  /** JSON-RPC client for communication with the language server */
  transport: LSITransport;
}

export class LSClient {
  public ready: boolean;
  public capabilities: LSP.ServerCapabilities | null;

  public initializePromise: Promise<void>;
  public resolveInitialize?: () => void;

  private workspaceFolders: LSP.WorkspaceFolder[] | null;

  private initializationOptions: LanguageServerClientOptions["initializationOptions"];
  public clientCapabilities: LanguageServerClientOptions["capabilities"];

  private transport: LSITransport;

  public plugins: LSCore[];

  // biome-ignore lint/suspicious/noExplicitAny: for all handlers
  #requestEmitter = new Emitter<{ method: string; params: any }>();
  // biome-ignore lint/suspicious/noExplicitAny: for all handlers
  #notificationEmitter = new Emitter<{ method: string; params: any }>();
  // biome-ignore lint/suspicious/noExplicitAny: for all handlers
  #errorEmitter = new Emitter<any>();

  constructor({
    workspaceFolders,
    initializationOptions,
    capabilities,
    transport,
  }: LanguageServerClientOptions) {
    this.workspaceFolders = workspaceFolders;
    this.initializationOptions = initializationOptions;
    this.clientCapabilities = capabilities;
    this.transport = transport;
    this.ready = false;
    this.capabilities = null;
    this.plugins = [];

    this.initializePromise = new Promise<void>((resolve) => {
      this.resolveInitialize = resolve;
    });

    this.#registerHandlers();

    void this.initialize(true);
  }

  /**
   * Change the underlying transport used for communication with the language server. Updates
   * the transport and re-registers all handlers.
   *
   * @param newTransport The new LSITransport to use.
   */
  public changeTransport(newTransport: LSITransport) {
    this.transport = newTransport;

    this.#registerHandlers();
  }

  #registerHandlers() {
    this.transport.onRequest((method, params) => {
      this.#requestEmitter.fire({ method, params });
    });

    this.transport.onNotification((method, params) => {
      this.#notificationEmitter.fire({ method, params });
    });

    this.transport.onError((error) => {
      this.#errorEmitter.fire(error);
    });
  }

  protected getInitializationOptions(): LSP.InitializeParams["initializationOptions"] {
    const defaultClientCapabilities: LSP.ClientCapabilities = {
      textDocument: {
        hover: {
          dynamicRegistration: true,
          contentFormat: ["markdown", "plaintext"],
        },
        moniker: {},
        synchronization: {
          dynamicRegistration: true,
          willSave: false,
          didSave: false,
          willSaveWaitUntil: false,
        },
        codeAction: {
          dynamicRegistration: true,
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: [
                "",
                "quickfix",
                "refactor",
                "refactor.extract",
                "refactor.inline",
                "refactor.rewrite",
                "source",
                "source.organizeImports",
              ],
            },
          },
          resolveSupport: {
            properties: ["edit"],
          },
        },
        completion: {
          dynamicRegistration: true,
          completionItem: {
            snippetSupport: true,
            insertReplaceSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ["markdown", "plaintext"],
            deprecatedSupport: false,
            resolveSupport: {
              properties: ["documentation", "detail", "additionalTextEdits"],
            },
            preselectSupport: true,
          },
          contextSupport: true,
        },
        signatureHelp: {
          dynamicRegistration: true,
          signatureInformation: {
            documentationFormat: ["markdown", "plaintext"],
          },
        },
        declaration: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        definition: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        typeDefinition: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        implementation: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        rename: {
          dynamicRegistration: true,
          prepareSupport: true,
        },
      },
      workspace: {
        didChangeConfiguration: {
          dynamicRegistration: true,
        },
      },
    };

    const defaultOptions = {
      capabilities: this.clientCapabilities
        ? typeof this.clientCapabilities === "function"
          ? this.clientCapabilities(defaultClientCapabilities)
          : this.clientCapabilities
        : defaultClientCapabilities,
      initializationOptions: this.initializationOptions,
      processId: null,
      workspaceFolders: this.workspaceFolders,
    };

    return defaultOptions;
  }

  public async initialize(andPlugins = false) {
    const response = await this.request(
      "initialize",
      this.getInitializationOptions(),
    );

    if (response === null || response === undefined) {
      throw new Error("Initialization response is null or undefined");
    }

    this.capabilities = response.capabilities;
    await this.notify("initialized", {});
    this.ready = true;

    this.resolveInitialize?.();

    if (andPlugins) {
      await Promise.all(this.plugins.map((plugin) => plugin.initialize()));
    }
  }

  public close() {
    this.transport.close?.();
    this.#requestEmitter.dispose();
    this.#notificationEmitter.dispose();
    this.#errorEmitter.dispose();
  }

  public async request<K extends keyof LSPRequestMap>(
    method: K,
    params: LSPRequestMap[K][0],
  ): Promise<LSPRequestMap[K][1]> {
    if (method !== "initialize" && !this.ready) {
      await this.initializePromise;
    }

    return await this.requestUnsafe(method, params);
  }

  // biome-ignore lint/suspicious/noExplicitAny: explicitly for unsafe requests
  public async requestUnsafe(method: string, params: any): Promise<any> {
    return await this.transport.sendRequest(method, params);
  }

  /**
   * Send a notification to the LSP server.
   *
   * @param method The LSP method to notify
   * @param params The parameters for the notification method
   * @returns A promise that resolves when the notification is sent
   */
  public notify<T extends keyof LSPNotifyMap>(
    method: T,
    params: LSPNotifyMap[T],
  ): Promise<void> {
    return this.notifyUnsafe(method, params);
  }

  // biome-ignore lint/suspicious/noExplicitAny: explicitly for unsafe notifications
  public async notifyUnsafe(method: string, params: any): Promise<any> {
    return this.transport.sendNotification(method, params);
  }

  // biome-ignore lint/suspicious/noExplicitAny: for all handlers
  public onRequest(handler: (method: string, params: any) => any): () => void {
    return this.#requestEmitter.event(({ method, params }) =>
      handler(method, params),
    ).dispose;
  }

  public onNotification(
    // biome-ignore lint/suspicious/noExplicitAny: for all handlers
    handler: (method: string, params: any) => void,
  ): () => void {
    return this.#notificationEmitter.event(({ method, params }) =>
      handler(method, params),
    ).dispose;
  }

  // biome-ignore lint/suspicious/noExplicitAny: for all handlers
  public onError(handler: (error: any) => void): () => void {
    return this.#errorEmitter.event(handler).dispose;
  }
}
