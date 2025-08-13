import type { Text } from "@codemirror/state";
import { ChangeSet } from "@codemirror/state";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import PQueue from "p-queue";
import type { LSClient } from "./LSClient.js";
import type { LSPRequestMap } from "./types.lsp.js";

interface LSPluginArgs {
  client: LSClient;
  documentUri: string;
  languageId: string;
  view: EditorView;
  /**
   * Whether to send a `textDocument/didClose` notification when the view is destroyed.
   *
   * Generally should be true, but be careful when managing multiple documents
   * with a single LSP instance, where you close one and it thinks the rest are
   * closed.
   *
   * @default true
   */
  sendCloseOnDestroy?: boolean;
  sendDidOpen?: boolean;
}

class LSCoreBase {
  public readonly client: LSClient;
  public readonly documentUri: string;
  public documentVersion: number;

  #sendChangesDispatchQueue = new PQueue({ concurrency: 1 });
  #currentSyncController: AbortController | null = null;
  #lastSentChanges: string = "";

  #languageId: string;
  #view: EditorView;
  #sendDidOpen: boolean;

  constructor({
    client,
    documentUri,
    languageId,
    view,
    sendDidOpen = true,
  }: LSPluginArgs) {
    this.documentVersion = 0;
    this.client = client;
    this.documentUri = documentUri;
    this.#languageId = languageId;
    this.#view = view;
    this.#sendDidOpen = sendDidOpen;

    void this.initialize({ documentText: this.#view.state.doc.toString() });
  }

  public async initialize({ documentText }: { documentText?: string } = {}) {
    documentText = documentText ?? this.#view.state.doc.toString();

    if (this.client.initializePromise) {
      await this.client.initializePromise;
    }

    if (this.#sendDidOpen) {
      await this.client.notify("textDocument/didOpen", {
        textDocument: {
          uri: this.documentUri,
          languageId: this.#languageId,
          text: documentText,
          version: this.documentVersion,
        },
      });
    }
  }

  /**
   * Execute a callback with the current document while preventing concurrent modifications.
   * Changes will continue to be queued, but none will be sent to the LSP.
   *
   * @param callback A function that receives the current document text.
   * @returns The result of the callback.
   */
  public async doWithLock<T>(
    callback: (doc: Text) => T | Promise<T>,
    timeout = 5_000,
  ): Promise<T> {
    await this.#sendChangesDispatchQueue.onIdle(); // So that we get the most recent changes
    this.#sendChangesDispatchQueue.pause();
    try {
      return await Promise.race([
        callback(this.#view.state.doc),
        new Promise<T>((_, rej) => {
          window.setTimeout(() => {
            this.#sendChangesDispatchQueue.start();
            void this.syncChanges();
            rej(new Error("Lock timed out"));
          }, timeout);
        }),
      ]);
    } finally {
      this.#sendChangesDispatchQueue.start();
    }
  }

  /**
   * Make an LSP request while ensuring that no other changes are sent during the request.
   */
  public async requestWithLock<K extends keyof LSPRequestMap>(
    method: K,
    params: LSPRequestMap[K][0],
  ): Promise<LSPRequestMap[K][1]> {
    return this.doWithLock(async (_doc) => {
      return await this.client.request(method, params);
    });
  }

  public async syncChanges() {
    if (this.#lastSentChanges === this.#view.state.doc.toString()) return;
    if (!this.client.ready) return;

    const calledAtVersion = this.documentVersion;

    // If you spam a bunch of changes, the last one will be sent as a delta of
    // the most previously successful sync.
    this.#sendChangesDispatchQueue.clear();
    await this.#sendChangesDispatchQueue.onIdle();
    return await this.#sendChangesDispatchQueue.add(
      async () => {
        if (calledAtVersion !== this.documentVersion) return;

        this.#currentSyncController?.abort();
        this.#currentSyncController = new AbortController();
        await this.client.notify("textDocument/didChange", {
          textDocument: {
            uri: this.documentUri,
            version: ++this.documentVersion,
          },
          contentChanges: [{ text: this.#view.state.doc.toString() }],
        });
        this.#lastSentChanges = this.#view.state.doc.toString();
      },
      { priority: this.documentVersion }, // more recent = higher priority
    );
  }

  public async sendDidOpen() {
    await this.client.notify("textDocument/didOpen", {
      textDocument: {
        uri: this.documentUri,
        languageId: this.#languageId,
        version: ++this.documentVersion,
        text: this.#view.state.doc.toString(),
      },
    });
  }
}

export class LSCore extends LSCoreBase implements PluginValue {
  #args: LSPluginArgs;

  constructor(view: EditorView, args: Omit<LSPluginArgs, "view">) {
    super({ ...args, view });
    this.#args = { ...args, view };
  }

  public static ofOrThrow(view: EditorView): LSCore {
    const plugin = view.plugin(LSPlugin);
    if (!plugin) throw new Error("LSCore not found");
    return plugin;
  }

  public update({ docChanged }: ViewUpdate) {
    if (!docChanged) return;

    void this.syncChanges();
  }

  public destroy() {
    if (this.#args.sendCloseOnDestroy !== false) {
      this.#args.client.notify("textDocument/didClose", {
        textDocument: {
          uri: this.#args.documentUri,
        },
      });
    }
  }
}

export const LSPlugin = ViewPlugin.fromClass(LSCore);
