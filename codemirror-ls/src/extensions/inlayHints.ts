/**
 * @module inlayHints
 * @description Extensions for handling inlay hints in the editor.
 *
 * Inlay hints provide additional information about code elements,
 * such as type annotations, parameter names, and other contextual details. They
 * are the things that show up inline in your code, like the names of function
 * parameters.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_inlayHint
 * @todo Fancy editors only request inlay hints for the visible part of the document
 * @todo Add resolve support
 */

import {
  Decoration,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import PQueue from "p-queue";
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos, posToOffset } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

/**
 * Renderer function for inlay hints.
 *
 * Some inlay hints are "fancy" and can be resolved for additional
 * information/actions (like special tooltips).
 */
export type InlayHintsRenderer = Renderer<
  [hint: LSP.InlayHint, resolve: () => Promise<LSP.InlayHint | null>]
>;

export interface InlayHintArgs {
  render: InlayHintsRenderer;
  /** Inlay hints will be debounced to only start showing up after this long (in ms) */
  debounceTime?: number;
  /** Whether to clear the currently shown inlay hints when the user starts editing. */
  clearOnEdit?: boolean;
  /** Whether the inlay hints come before or after the cursor. */
  sideOfCursor?: "after" | "before";
}

export const getInlayHintExtensions: LSExtensionGetter<InlayHintArgs> = ({
  render,
  debounceTime = 1_000,
  clearOnEdit = true,
  sideOfCursor = "after",
}: InlayHintArgs) => {
  return [
    ViewPlugin.fromClass(
      class {
        /**
         * Pending textDocument/inlayHint requests queue.
         *
         * If we aren't debounced "enough" and request many at close to the same
         * time, we want to make sure we apply them in the order we sent them,
         * not the order they return.
         **/
        #requestQueue = new PQueue({ concurrency: 1 });

        #debounceTimeoutId: number | null = null;
        #view: EditorView;

        inlayHints: LSP.InlayHint[] | null = null;

        constructor(view: EditorView) {
          this.#view = view;
          void this.#queueRefreshInlayHints();
        }

        update(update: ViewUpdate) {
          if (!update.docChanged) return;

          if (clearOnEdit) {
            // the .decorations() provider is naturally triggered on updates so
            // no need to dispatch (also, we cannot dispatch DURING an update).
            this.inlayHints = [];
          }

          void this.#queueRefreshInlayHints();
        }

        async #queueRefreshInlayHints() {
          if (this.#debounceTimeoutId) {
            window.clearInterval(this.#debounceTimeoutId);
          }

          this.#debounceTimeoutId = window.setTimeout(async () => {
            const lsCore = LSCore.ofOrThrow(this.#view);

            if (lsCore.client.capabilities?.inlayHintProvider === false) {
              return null;
            }

            const endOfDocPos = this.#view.state.doc.length - 1;
            const newInlayHints = this.#requestQueue.add(
              async () =>
                await lsCore.client.request("textDocument/inlayHint", {
                  textDocument: { uri: lsCore.documentUri },
                  range: {
                    start: { line: 0, character: 0 },
                    end: offsetToPos(this.#view.state.doc, endOfDocPos),
                  },
                }),
            );
            this.inlayHints = (await newInlayHints) ?? [];

            // This is an event "in the middle of nowhere" -- it's based on a
            // timeout. We need to dispatch to force a requery of decorations.
            this.#view.dispatch();
          }, debounceTime);
        }

        get decorations() {
          if (this.inlayHints === null) return Decoration.none;

          const decorations = this.inlayHints
            .map((hint) => {
              const offset = posToOffset(this.#view.state.doc, hint.position);
              if (offset === undefined) return null;

              return Decoration.widget({
                widget: new InlayHintWidget(hint, render, this.#view),
                // Side is a number -1000 to 1000, which orders the widgets. >0
                // means after the cursor, <0 means before the cursor.
                side: sideOfCursor === "after" ? 1 : -1,
              }).range(offset);
            })
            .filter((widget) => widget !== null);

          return Decoration.set(decorations, true);
        }
      },
      {
        decorations: (v) => v.decorations,
      },
    ),
  ];
};

class InlayHintWidget extends WidgetType {
  #inlayHint: LSP.InlayHint;
  #render: InlayHintsRenderer;
  #view: EditorView;

  constructor(
    inlayHint: LSP.InlayHint,
    render: InlayHintsRenderer,
    view: EditorView,
  ) {
    super();

    this.#inlayHint = inlayHint;
    this.#render = render;
    this.#view = view;
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inlay-hint";
    void this.#render(span, this.#inlayHint, async () => {
      const lsCore = LSCore.ofOrThrow(this.#view);

      // Some inlay hints have "fancy" extras that we should only render when
      // they come into view (this is the case when there is a "data" field)
      if ("data" in this.#inlayHint) {
        this.#inlayHint =
          (await lsCore.client.request("inlayHint/resolve", this.#inlayHint)) ??
          this.#inlayHint;
      }

      return this.#inlayHint;
    });
    return span;
  }

  override eq(other: InlayHintWidget) {
    return (
      this.#inlayHint.position.line === other.#inlayHint.position.line &&
      this.#inlayHint.position.character ===
        other.#inlayHint.position.character &&
      this.#inlayHint.label === other.#inlayHint.label
    );
  }
}
