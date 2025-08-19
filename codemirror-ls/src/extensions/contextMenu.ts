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
import { handleRename } from "./renames.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface ContextMenuArgs {
  render: ContextMenuRenderer;
  referencesArgs: ReferenceExtensionsArgs;
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
  goToDefinition?: () => void;
  goToTypeDefinition?: () => void;
  goToImplementation?: () => void;
  findAllReferences?: () => void;
  rename?: () => void;
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

        view.dispatch(
          view.state.update({
            annotations: contextMenuActivated.of({ event, pos }),
          }),
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
  disableGoToDefinition,
  disableGoToTypeDefinition,
  disableGoToImplementation,
  disableFindAllReferences,
  disableRename,
}: {
  view: EditorView;
  referencesArgs: ReferenceExtensionsArgs;
  disableGoToDefinition?: boolean;
  disableGoToTypeDefinition?: boolean;
  disableGoToImplementation?: boolean;
  disableFindAllReferences?: boolean;
  disableRename?: boolean;
}) {
  const lsPlugin = LSCore.ofOrThrow(view);

  const { capabilities } = lsPlugin.client;
  if (!capabilities) {
    return {};
  }

  let goToDefinitionCallback: (() => void) | undefined;
  let goToTypeDefinitionCallback: (() => void) | undefined;
  let goToImplementationCallback: (() => void) | undefined;
  let findAllReferencesCallback: (() => void) | undefined;
  let renameCallback: (() => void) | undefined;

  if (
    !disableGoToDefinition &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/definition"]]
  ) {
    goToDefinitionCallback = () => {
      if (lsPlugin.client.capabilities?.definitionProvider) {
        handleFindReferences({
          view,
          kind: "textDocument/definition",
          goToIfOneOption: true,
        });
      }
    };
  }

  if (
    !disableGoToTypeDefinition &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/typeDefinition"]]
  ) {
    goToTypeDefinitionCallback = () => {
      if (lsPlugin.client.capabilities?.typeDefinitionProvider) {
        handleFindReferences({
          view,
          kind: "textDocument/typeDefinition",
          goToIfOneOption: true,
        });
      }
    };
  }

  if (
    !disableGoToImplementation &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/implementation"]]
  ) {
    goToImplementationCallback = () => {
      if (lsPlugin.client.capabilities?.implementationProvider) {
        handleFindReferences({
          view,
          kind: "textDocument/implementation",
          goToIfOneOption: true,
        });
      }
    };
  }

  if (
    !disableFindAllReferences &&
    capabilities?.[REFERENCE_CAPABILITY_MAP["textDocument/references"]]
  ) {
    findAllReferencesCallback = () => {
      if (lsPlugin.client.capabilities?.referencesProvider) {
        handleFindReferences({
          view,
          kind: "textDocument/references",
          ...referencesArgs,
        });
      }
    };
  }

  if (!disableRename && capabilities?.renameProvider) {
    renameCallback = () => {
      if (lsPlugin.client.capabilities?.renameProvider) {
        handleRename({
          view,
          renameEnabled: true,
        });
      }
    };
  }

  return {
    goToDefinition: goToDefinitionCallback,
    goToTypeDefinition: goToTypeDefinitionCallback,
    goToImplementation: goToImplementationCallback,
    findAllReferences: findAllReferencesCallback,
    rename: renameCallback,
  };
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
