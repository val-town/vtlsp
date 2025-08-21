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
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos, posToOffset } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { Annotation } from "@codemirror/state";

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
            // no need to dispatch.
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
            this.inlayHints = await lsCore.client.request(
              "textDocument/inlayHint",
              {
                textDocument: { uri: lsCore.documentUri },
                range: {
                  start: { line: 0, character: 0 },
                  end: offsetToPos(this.#view.state.doc, endOfDocPos),
                },
              },
            );

            // This is an event "in the middle of nowhere" -- it's based on a
            // timeout. We need to dispatch to force a requery of decorations.
            this.#view.dispatch({
              annotations: [inlayHintsUpdate.of(this.inlayHints)],
            });
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
                side: -1,
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

const inlayHintsUpdate = Annotation.define<LSP.InlayHint[] | null>();

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
      const resolvedHint = await lsCore.client.request(
        "inlayHint/resolve",
        this.#inlayHint,
      );

      if (resolvedHint) {
        this.#inlayHint = resolvedHint;
        return resolvedHint;
      }

      return null;
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
