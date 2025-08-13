import type { Text } from "@codemirror/state";
import { ChangeSet } from "@codemirror/state";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import { type EditorView, showDialog, ViewPlugin } from "@codemirror/view";
import PQueue from "p-queue";
import * as LSP from "vscode-languageserver-protocol";
import type { LSClient } from "./LSClient.js";
import type { LSPRequestMap } from "./types.lsp.js";
import { eventsFromChangeSet } from "./utils.js";

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
  /**
   * Whether to send incremental changes or full text updates.
   * If false, sends the entire document text instead of contentChanges. Generally you should
   * send incremental changes, but if you are sharing an LSP instance across multiple documents,
   * you may want to send full text updates instead.
   *
   * @default true
   */
  sendIncrementalChanges?: boolean;
}

class LSCoreBase {
  public readonly client: LSClient;
  public readonly documentUri: string;
  public documentVersion: number;

  #sendChangesDispatchQueue = new PQueue({ concurrency: 1 });
  #pendingChanges: ChangeSet;
  #lastSyncedDoc: Text;
  #currentSyncController: AbortController | null = null;

  #languageId: string;
  #view: EditorView;
  #sendDidOpen: boolean;
  #sendIncrementalChanges: boolean;

  constructor({
    client,
    documentUri,
    languageId,
    view,
    sendDidOpen = true,
    sendIncrementalChanges = true,
  }: LSPluginArgs) {
    this.documentVersion = 0;
    this.client = client;
    this.documentUri = documentUri;
    this.#languageId = languageId;
    this.#view = view;
    this.#sendDidOpen = sendDidOpen;
    this.#sendIncrementalChanges = sendIncrementalChanges;

    this.#pendingChanges = ChangeSet.empty(view.state.doc.length);
    this.#lastSyncedDoc = view.state.doc;

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
    timeout = 5000,
  ): Promise<T> {
    this.#sendChangesDispatchQueue.pause();
    try {
      await this.#sendChangesDispatchQueue.onIdle();
      return await Promise.race([
        callback(this.#view.state.doc),
        new Promise<T>((_, rej) =>
          window.setTimeout(() => rej(new Error("Lock timed out")), timeout),
        ),
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

  public async queueChanges(changes: ChangeSet) {
    this.#pendingChanges = this.#pendingChanges.compose(changes);
  }

  public async syncChanges() {
    if (this.#pendingChanges.empty) return;
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
          contentChanges: this.#sendIncrementalChanges
            ? eventsFromChangeSet(this.#lastSyncedDoc, this.#pendingChanges)
            : [{ text: this.#view.state.doc.toString() }],
        });
        this.#lastSyncedDoc = this.#view.state.doc;
        this.#pendingChanges = ChangeSet.empty(this.#view.state.doc.length);
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

  public update({ docChanged, changes }: ViewUpdate) {
    if (!docChanged) return;

    this.queueChanges(changes);
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
