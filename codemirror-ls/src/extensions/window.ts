import type { EditorView } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import type * as LSP from "vscode-languageserver-protocol";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { LSCore } from "../LSPlugin.js";

export interface WindowExtensionArgs {
  render: WindowRenderer;
}

export type WindowRenderer = Renderer<
  [message: LSP.ShowMessageParams, onDismiss: () => void]
>;

export const getWindowExtensions: LSExtensionGetter<WindowExtensionArgs> = ({
  render,
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
                this.#showMessage(params as LSP.ShowMessageParams);
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
