import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { Annotation, StateField } from "@codemirror/state";
import { handleRename } from "./renames";
import {
  handleFindReferences,
  type ReferenceExtensionsArgs,
} from "./references";
import type { LSExtensionGetter, Renderer } from "./types";

export interface ContextMenuArgs {
  render: ContextMenuRenderer;
  referencesArgs: ReferenceExtensionsArgs;
}

export type ContextMenuRenderer = Renderer<[callbacks: ContextMenuCallbacks]>;

export type ContextMenuCallbacks = {
  goToDefinition: () => void;
  goToTypeDefinition: () => void;
  goToImplementation: () => void;
  findAllReferences: () => void;
  rename: () => void;
};

export const getContextMenuExtensions: LSExtensionGetter<ContextMenuArgs> = ({
  render,
  referencesArgs,
}) => {
  const contextMenuField = StateField.define<readonly Tooltip[]>({
    create() {
      return [];
    },

    update(tooltips, tr) {
      const clickData = tr.annotation(contextMenuActivated);

      if (clickData) {
        return getContextMenuTooltip(clickData.pos, render, referencesArgs);
      }

      // We clear them with event listeners

      return tooltips;
    },

    provide: (field) => {
      return showTooltip.computeN([field], (state) => state.field(field));
    },
  });

  return [
    contextMenuField,
    EditorView.domEventHandlers({
      contextmenu: (event, view) => {
        if (event.button !== 2) return false; // Only handle right-clicks

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        view.dispatch(
          view.state.update({
            annotations: contextMenuActivated.of({ event, pos }),
          })
        );

        event.preventDefault();
        return true; // Handled the event, don't show normal context menu
      },
    }),
  ];
};

export const contextMenuActivated = Annotation.define<{
  event: MouseEvent;
  pos: number;
}>();

export function handleContextMenu({
  view,
  referencesArgs,
}: {
  view: EditorView;
  referencesArgs: ReferenceExtensionsArgs;
}) {
  return {
    goToDefinition: () =>
      handleFindReferences({
        view,
        kind: "textDocument/definition",
        goToIfOneOption: true,
      }),
    goToTypeDefinition: () =>
      handleFindReferences({
        view,
        kind: "textDocument/typeDefinition",
        goToIfOneOption: true,
      }),
    goToImplementation: () =>
      handleFindReferences({
        view,
        kind: "textDocument/implementation",
        goToIfOneOption: true,
      }),
    findAllReferences: () =>
      handleFindReferences({
        view,
        kind: "textDocument/references",
        ...referencesArgs,
      }),
    rename: () =>
      handleRename({
        view,
        renameEnabled: true,
      }),
  };
}

function getContextMenuTooltip(
  pos: number,
  render: ContextMenuRenderer,
  referencesArgs: ReferenceExtensionsArgs
): readonly Tooltip[] {
  return [
    {
      pos,
      above: false,
      create: (view) => {
        const contextMenuCallbacks = handleContextMenu({
          view,
          referencesArgs,
        });

        let dom = document.createElement("div");
        render(dom, contextMenuCallbacks);

        const removedAbortController = new AbortController();

        // If they click out, remove it
        view.dom.addEventListener(
          "click",
          () => {
            dom.remove();
          },
          { signal: removedAbortController.signal }
        );

        // If they press escape, remove it
        view.dom.addEventListener(
          "keydown",
          (e) => {
            if (e.key === "Escape") {
              dom.remove();
              removedAbortController.abort();
            }
          },
          { signal: removedAbortController.signal }
        );

        return {
          dom,
          destroy() {
            removedAbortController.abort();
          },
        };
      },
    },
  ];
}
