/**
 * @module inlayHints
 * @description Extensions for handling inlay hints in the editor.
 *
 * Inlay hints provide additional information about code elements,
 * such as type annotations, parameter names, and other contextual details. They
 * are the things that show up inline in your code, like the names of function
 * parameters.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_hover
 */

import { StateField, Annotation, ChangeSet } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, type ViewUpdate, ViewPlugin, WidgetType } from "@codemirror/view";
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { offsetToPos, posToOffset } from "../utils.js";

export type InlayHintsRenderer = Renderer<[hint: LSP.InlayHint]>;

export interface InlayHintArgs {
  render: InlayHintsRenderer;
  /** Inlay hints will be debounced to only start showing up after this long. */
  debounceTime?: number;
  /** Whether to clear the currently shown inlay hints when the user starts editing. */
  clearOnEdit?: boolean;
}

export const getInlayHintExtensions: LSExtensionGetter<InlayHintArgs> = ({
  render,
  debounceTime = 100,
  clearOnEdit = true,
}: InlayHintArgs) => {
  return [
    inlayHintState,
    createInlayHintProvider(render),
    ViewPlugin.fromClass(class {
      timeWindowChangeSet: ChangeSet
      #debounceTimeoutId: number | null = null;
      #doingUpdate = false;

      constructor(view: EditorView) {
        this.timeWindowChangeSet = ChangeSet.empty(view.state.doc.length);

        void this.#runFullDocumentInlayHints(view);
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.#debounceTimeoutId) {
          clearTimeout(this.#debounceTimeoutId);
        }

        if (clearOnEdit) {
          update.view.dispatch({
            annotations: inlayHintUpdate.of(null),
          });
        }

        this.timeWindowChangeSet = this.timeWindowChangeSet.compose(update.changes);
        this.#scheduleUpdateInlayHints(update.view);
      }

      async #runFullDocumentInlayHints(view: EditorView) {
        if (this.#doingUpdate) return;
        this.#doingUpdate = true;

        try {
          const inlayHints = await getFullDocumentInlayHints(view);
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

        let veryStart = 0;
        let veryEnd = view.state.doc.length - 1;

        this.timeWindowChangeSet.iterChangedRanges((fromA, toA, fromB, toB) => {
          veryStart = Math.min(veryStart, Math.min(fromA, fromB));
          veryEnd = Math.max(veryEnd, Math.max(toA, toB));
        });

        this.#debounceTimeoutId = window.setTimeout(async () => {
          const inlayHints = await getInlayHints({
            view,
            start: offsetToPos(view.state.doc, veryStart),
            end: offsetToPos(view.state.doc, veryEnd),
          });

          this.#debounceTimeoutId = null;
          if (inlayHints) {
            this.#updateInlayHints(view, inlayHints);
          }
        }, debounceTime);
      }

      async #updateInlayHints(view: EditorView, inlayHints?: LSP.InlayHint[]) {
        if (inlayHints) {
          view.dispatch({
            annotations: inlayHintUpdate.of(inlayHints),
          });
        }
      }
    })
  ];
};

async function getFullDocumentInlayHints(view: EditorView) {
  const endOfDocPos = view.state.doc.length - 1;

  return await getInlayHints({
    view: view,
    start: { line: 0, character: 0 },
    end: offsetToPos(view.state.doc, endOfDocPos),
  });
}

const inlayHintUpdate = Annotation.define<LSP.InlayHint[] | null>();

const inlayHintState = StateField.define<LSP.InlayHint[]>({
  create() {
    return [];
  },
  update(inlayHints, tr) {
    if (tr.annotation(inlayHintUpdate) == null) return []

    const allInlayHints = [...new Set([...inlayHints, ...(tr.annotation(inlayHintUpdate) ?? [])])];
    return allInlayHints;
  },
});

const createInlayHintProvider = (render: InlayHintsRenderer) => {
  return ViewPlugin.fromClass(class {
    hints: DecorationSet = Decoration.none;

    constructor(view: EditorView) {
      this.updateDecorations(view);
    }

    update(update: ViewUpdate) {
      // Update the decorations if the inlay hints have changed or if the document has changed
      if (update.docChanged || update.state.field(inlayHintState) !== update.startState.field(inlayHintState)) {
        this.updateDecorations(update.view);
      }
    }

    updateDecorations(view: EditorView) {
      const inlayHints = view.state.field(inlayHintState); // get all the current inlay hints
      const decorations = inlayHints.map(hint => {
        const offset = posToOffset(view.state.doc, hint.position);
        if (offset === undefined) return null;

        return Decoration.widget({
          widget: new InlayHintWidget(hint, render),
          side: -1,
        }).range(offset);
      }).filter(widget => widget !== null);

      this.hints = Decoration.set(decorations, true);
    }
  }, {
    decorations: v => v.hints
  });
};

class InlayHintWidget extends WidgetType {
  constructor(private hint: LSP.InlayHint, private render: InlayHintsRenderer) {
    super();
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inlay-hint";
    
    // Use the default fallback rendering if the render function fails
    const defaultContent = Array.isArray(this.hint.label)
      ? this.hint.label.map(item => typeof item === 'string' ? item : item.value).join('')
      : this.hint.label;
    span.textContent = defaultContent;

    // Call the custom renderer
    void this.render(span, this.hint).catch(() => {
      // If custom rendering fails, keep the default content
    });

    return span;
  }
}

async function getInlayHints({
  view,
  start,
  end,
}: {
  view: EditorView;
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Promise<LSP.InlayHint[] | null> {
  const lsCore = LSCore.ofOrThrow(view);

  if (lsCore.client.capabilities?.inlayHintProvider === false) {
    return null;
  }

  const result = await lsCore.client.request(
    "textDocument/inlayHint",
    {
      textDocument: { uri: lsCore.documentUri },
      range: {
        start,
        end,
      }
    },
  );

  if (!result) return result;

  return getInlayHintsByUri(result, lsCore.documentUri);
}

function getInlayHintsByUri(hints: LSP.InlayHint[], targetUri: string): LSP.InlayHint[] {
  return hints.filter(hint => {
    // Check if this hint has label items with location information                                                                                                                                                             
    if (Array.isArray(hint.label)) {
      // Check if any label item has a matching URI                                                                                                                                                                             
      return hint.label.some((labelItem: { location?: { uri: string } }) =>
        labelItem.location &&
        labelItem.location.uri === targetUri
      );
    }
    return false;
  });
}  
