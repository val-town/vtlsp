/**
 * @module window
 * @description Extensions for handling window/showMessage notifications from the LSP server.
 *
 * These notifications are used to display messages to the user, such as errors,
 * warnings, or informational messages.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#window_showMessage
 */

import type { EditorView } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { LSCore } from "../LSPlugin.js";

export interface WindowExtensionArgs {
  render: WindowRenderer;
  /** Minimum message level to render/display */
  minLevel?: LSP.MessageType;
  /** Predicate for whether a message should be ignored */
  shouldIgnore?: (message: LSP.ShowMessageParams) => boolean;
}

export type WindowRenderer = Renderer<
  [message: LSP.ShowMessageParams, onDismiss: () => void]
>;

export const getWindowExtensions: LSExtensionGetter<WindowExtensionArgs> = ({
  render,
  minLevel = LSP.MessageType.Warning,
  shouldIgnore,
}) => {
  return [
    ViewPlugin.fromClass(
      class WindowPlugin {
        #disposeHandler: (() => void) | null = null;

        constructor(view: EditorView) {
          const lsPlugin = LSCore.ofOrThrow(view);

          this.#disposeHandler = lsPlugin.client.onNotification(
            async (method, params) => {
              if (method === "window/showMessage") {
                const messageParams = params as LSP.ShowMessageParams;
                if (messageParams.type < minLevel) return;
                if (shouldIgnore?.(messageParams)) return;

                this.#showMessage(messageParams);
              }
            },
          );
        }

        destroy() {
          if (this.#disposeHandler) {
            this.#disposeHandler();
            this.#disposeHandler = null;
          }
        }

        #showMessage(params: LSP.ShowMessageParams) {
          const container = document.createElement("div");
          const onDismiss = () => container.remove();

          render(container, params, onDismiss);
          document.body.appendChild(container);
        }
      },
    ),
  ];
};
