import type { Text } from "@codemirror/state";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import PQueue from "p-queue";
import type * as LSP from "vscode-languageserver-protocol";
import type { LSClient } from "./LSClient.js";
import type { LSPRequestMap } from "./types.lsp.js";
import { posToOffset } from "./utils.js";

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
  /** Called when a workspace edit is received, for events that may have edited some or many files. */
  onWorkspaceEdit?: (edit: LSP.WorkspaceEdit) => void | Promise<void>;
}

class LSCoreBase {
  public readonly client: LSClient;
  public readonly documentUri: string;
  public documentVersion: number;

  #sendChangesDispatchQueue = new PQueue({ concurrency: 1 });
  #currentSyncController: AbortController | null = null;
  #lastSentChanges = "";

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

  public _waitForSync(): Promise<void> {
    return this.#sendChangesDispatchQueue.onIdle();
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
    await this.syncChanges();
    await this.#sendChangesDispatchQueue.onIdle();
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
      await this.syncChanges();
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

  public async syncChanges(): Promise<boolean> {
    if (this.#lastSentChanges === this.#view.state.doc.toString()) return false;
    if (!this.client.ready) return false;

    const calledAtVersion = this.documentVersion;

    // If you spam a bunch of changes, the last one will be sent as a delta of
    // the most previously successful sync.
    this.#sendChangesDispatchQueue.clear();
    await this.#sendChangesDispatchQueue.onIdle();
    this.#currentSyncController?.abort();
    const abortController = new AbortController();
    this.#currentSyncController = abortController;
    return (
      (await this.#sendChangesDispatchQueue.add(
        async () => {
          if (calledAtVersion !== this.documentVersion) return false;

          await this.client.notify("textDocument/didChange", {
            textDocument: {
              uri: this.documentUri,
              version: ++this.documentVersion,
            },
            contentChanges: [{ text: this.#view.state.doc.toString() }],
          });
          this.#lastSentChanges = this.#view.state.doc.toString();

          return true;
        },
        { priority: this.documentVersion, signal: abortController.signal }, // more recent = higher priority
      )) ?? false
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
  #view: EditorView;

  constructor(view: EditorView, args: Omit<LSPluginArgs, "view">) {
    super({ ...args, view });
    this.#args = { ...args, view };
    this.#view = view;
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

  /**
   * Apply a WorkspaceEdit. Updates the current document with all applicable
   * changes and hits the global callback with the WorkspaceEdit.
   *
   * @param edit The workspace edit to apply.
   * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspaceEdit
   */
  public async applyWorkspaceEdit(edit: LSP.WorkspaceEdit) {
    let editsForThisDocument: LSP.TextEdit[] = [];

    if (edit.documentChanges) {
      const changesForThisDocument = edit.documentChanges.filter(
        (change): change is LSP.TextDocumentEdit =>
          "textDocument" in change &&
          change.textDocument.uri === this.documentUri,
      );
      editsForThisDocument = changesForThisDocument.flatMap(
        (change) => change.edits,
      );
    } else if (edit.changes) {
      editsForThisDocument = edit.changes[this.documentUri] ?? [];
    }

    if (editsForThisDocument.length > 0) {
      const sortedEdits = editsForThisDocument.sort((a, b) => {
        const posA = posToOffset(this.#view.state.doc, a.range.start);
        const posB = posToOffset(this.#view.state.doc, b.range.start);
        return (posB ?? 0) - (posA ?? 0);
      });

      const transaction = this.#view.state.update({
        changes: sortedEdits.map((edit) => ({
          from: posToOffset(this.#view.state.doc, edit.range.start)!,
          to: posToOffset(this.#view.state.doc, edit.range.end)!,
          insert: edit.newText,
        })),
      });

      this.#view.dispatch(transaction);
    }

    await this.#args.onWorkspaceEdit?.(edit);
  }
}

export const LSPlugin = ViewPlugin.fromClass(LSCore);
