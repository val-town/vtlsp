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
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { offsetToPos, posToOffset } from "../utils.js";
import { Annotation } from "@codemirror/state";

export type InlayHintsRenderer = Renderer<[hint: LSP.InlayHint]>;

export interface InlayHintArgs {
  render: InlayHintsRenderer;
  /** Inlay hints will be debounced to only start showing up after this long (in ms) */
  debounceTime?: number;
  /** Whether to clear the currently shown inlay hints when the user starts editing. */
  clearOnEdit?: boolean;
}

export const getInlayHintExtensions: LSExtensionGetter<InlayHintArgs> = ({
  render,
  debounceTime = 1_000,
  clearOnEdit = true,
}: InlayHintArgs) => {
  return [
    ViewPlugin.fromClass(
      class {
        #debounceTimeoutId: number | null = null;
        #doingUpdate = false;
        hints: DecorationSet = Decoration.none;
        currentInlayHints: LSP.InlayHint[] = [];

        constructor(view: EditorView) {
          this.#updateDecorations(view);
          void this.#runFullDocumentInlayHints(view);
        }

        update(update: ViewUpdate) {
          // Update the decorations if the document has changed
          if (update.docChanged) {
            this.#updateDecorations(update.view);
          }

          if (!update.docChanged) return;
          if (this.#debounceTimeoutId) {
            clearTimeout(this.#debounceTimeoutId);
          }

          if (clearOnEdit) {
            this.currentInlayHints = [];
            this.#updateDecorations(update.view);
          }

          this.#scheduleUpdateInlayHints(update.view);
        }

        #updateDecorations(view: EditorView) {
          const decorations = this.currentInlayHints
            .map((hint) => {
              const offset = posToOffset(view.state.doc, hint.position);
              if (offset === undefined) return null;

              return Decoration.widget({
                widget: new InlayHintWidget(hint, render),
                side: -1,
              }).range(offset);
            })
            .filter((widget) => widget !== null);

          this.hints = Decoration.set(decorations, true);
        }

        async #runFullDocumentInlayHints(view: EditorView) {
          if (this.#doingUpdate) return;
          this.#doingUpdate = true;

          try {
            const inlayHints = await getFullDocumentInlayHints({ view });
            if (!inlayHints) return;
            void this.#updateInlayHints(view, inlayHints);
          } finally {
            this.#doingUpdate = false;
          }
        }

        #scheduleUpdateInlayHints(view: EditorView) {
          if (this.#debounceTimeoutId) {
            clearTimeout(this.#debounceTimeoutId);
          }

          this.#debounceTimeoutId = window.setTimeout(async () => {
            const inlayHints = await getFullDocumentInlayHints({ view });

            this.#debounceTimeoutId = null;
            if (inlayHints) {
              this.#updateInlayHints(view, inlayHints);

              view.dispatch({
                annotations: inlayHintsApply.of(inlayHints),
              });
            }
          }, debounceTime);
        }

        async #updateInlayHints(
          view: EditorView,
          inlayHints?: LSP.InlayHint[],
        ) {
          if (inlayHints) {
            this.currentInlayHints = inlayHints;
            this.#updateDecorations(view);
          }
        }
      },
      {
        decorations: (v) => v.hints,
      },
    ),
  ];
};

const inlayHintsApply = Annotation.define<LSP.InlayHint[]>();

async function getFullDocumentInlayHints({
  view,
}: {
  view: EditorView;
}): Promise<LSP.InlayHint[] | null> {
  const lsCore = LSCore.ofOrThrow(view);

  if (lsCore.client.capabilities?.inlayHintProvider === false) {
    return null;
  }

  const endOfDocPos = view.state.doc.length - 1;
  const result = await lsCore.client.request("textDocument/inlayHint", {
    textDocument: { uri: lsCore.documentUri },
    range: {
      start: { line: 0, character: 0 },
      end: offsetToPos(view.state.doc, endOfDocPos),
    },
  });

  return result;
}

class InlayHintWidget extends WidgetType {
  constructor(
    private hint: LSP.InlayHint,
    private render: InlayHintsRenderer,
  ) {
    super();
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inlay-hint";

    void this.render(span, this.hint);

    return span;
  }
}
