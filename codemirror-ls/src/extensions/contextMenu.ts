/**
 * @module contextMenu
 * @description Extensions for handling context menus in the editor.
 * @author Modification of code from Marijnh's codemirror-lsp-client
 *
 * Context menus are an override for the default right-click context menu
 * that allows users to perform actions like going to definitions, finding
 * references, renaming symbols, etc.
 *
 * Note that this is not a standard LSP feature, but rather a custom
 * implementation that uses the LSP for callbacks with various actions.
 */

import { Annotation, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { LSCore } from "../LSPlugin.js";
import {
  handleFindReferences,
  REFERENCE_CAPABILITY_MAP,
  type ReferenceExtensionsArgs,
} from "./references.js";
import { handleRename, type RenameExtensionsArgs } from "./renames.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface ContextMenuArgs {
  render: ContextMenuRenderer;
  referencesArgs: ReferenceExtensionsArgs;
  renameArgs?: RenameExtensionsArgs;
  disableGoToDefinition?: boolean;
  disableGoToTypeDefinition?: boolean;
  disableGoToImplementation?: boolean;
  disableFindAllReferences?: boolean;
  disableRename?: boolean;
}

export type ContextMenuRenderer = Renderer<
  [callbacks: ContextMenuCallbacks, dismiss: () => void]
>;

export type ContextMenuCallbacks = {
  goToDefinition: (() => void) | null;
  goToTypeDefinition: (() => void) | null;
  goToImplementation: (() => void) | null;
  findAllReferences: (() => void) | null;
  rename?: (() => void) | null;
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

        // Only show a custom context menu if the symbol under the cursor is not empty
        const symbol = view.state.doc.sliceString(pos, pos + 2);
        if (/^[\s\n]*$/.test(symbol)) {
          return false;
        }

        view.dispatch(
          view.state.update({
            annotations: contextMenuActivated.of({ event, pos }),
          }),
        );

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
  pos,
  referencesArgs,
  renameArgs,
  disableGoToDefinition,
  disableGoToTypeDefinition,
  disableGoToImplementation,
  disableFindAllReferences,
  disableRename,
}: {
  view: EditorView;
  pos: number;
  disableGoToDefinition?: boolean;
  disableGoToTypeDefinition?: boolean;
  disableGoToImplementation?: boolean;
  disableFindAllReferences?: boolean;
  disableRename?: boolean;
  referencesArgs: ReferenceExtensionsArgs;
  renameArgs?: RenameExtensionsArgs;
}): ContextMenuCallbacks {
  const lsPlugin = LSCore.ofOrThrow(view);

  const callbacks: ContextMenuCallbacks = {
    goToDefinition: null,
    goToTypeDefinition: null,
    goToImplementation: null,
    findAllReferences: null,
    rename: null,
  };

  const { capabilities } = lsPlugin.client;
  if (!capabilities) {
    return callbacks;
  }

  if (
    !disableGoToDefinition &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/definition"]]
  ) {
    callbacks.goToDefinition = () => {
      handleFindReferences({
        view,
        kind: "textDocument/definition",
        goToIfOneOption: true,
        pos,
        ...referencesArgs,
      });
    };
  }

  if (
    !disableGoToTypeDefinition &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/typeDefinition"]]
  ) {
    callbacks.goToTypeDefinition = () => {
      handleFindReferences({
        view,
        kind: "textDocument/typeDefinition",
        goToIfOneOption: true,
        pos,
        ...referencesArgs,
      });
    };
  }

  if (
    !disableGoToImplementation &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/implementation"]]
  ) {
    callbacks.goToImplementation = () => {
      handleFindReferences({
        view,
        kind: "textDocument/implementation",
        goToIfOneOption: true,
        pos,
        ...referencesArgs,
      });
    };
  }

  if (
    !disableFindAllReferences &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/references"]]
  ) {
    callbacks.findAllReferences = () => {
      handleFindReferences({
        view,
        kind: "textDocument/references",
        ...referencesArgs,
        pos,
        ...referencesArgs,
      });
    };
  }

  if (!disableRename && capabilities?.renameProvider) {
    callbacks.rename = () => {
      handleRename({
        view,
        renameEnabled: true,
        pos,
        ...renameArgs,
      });
    };
  }

  return callbacks;
}

function getContextMenuTooltip(
  pos: number,
  render: ContextMenuRenderer,
  referencesArgs: ReferenceExtensionsArgs,
): readonly Tooltip[] {
  return [
    {
      pos,
      above: false,
      create: (view) => {
        const contextMenuCallbacks = handleContextMenu({
          view,
          referencesArgs,
          pos,
        });

        const dom = document.createElement("div");
        dom.className = "cm-lsp-context-menu";
        render(dom, contextMenuCallbacks, () => {
          dom.remove();
        });

        return {
          dom,
        };
      },
    },
  ];
}
