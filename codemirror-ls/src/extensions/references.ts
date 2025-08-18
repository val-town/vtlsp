/**
 * @module references
 * @description Extensions for handling code references and go to definition.
 * @author Modification of code from Marijnh's codemirror-lsp-client
 *
 * Code references are the list of locations in the code where a symbol is
 * defined or used, such as function definitions, variable declarations, or
 * type definitions.
 *
 * Go to definition is related -- with go to definition the LSP requests a list
 * of locations a symbol occurs, the difference is that that list is
 * specifically locations that you can jump to, and that you automatically jump
 * to the location if there is only one definition found.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_references
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_definition
 * @see https://github.com/codemirror/lsp-client/blob/main/src/references.ts
 * @see https://github.com/codemirror/lsp-client/blob/main/src/definition.ts
 */

import {
  Annotation,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  type Command,
  EditorView,
  type KeyBinding,
  keymap,
  type PanelConstructor,
  showDialog,
  showPanel,
} from "@codemirror/view";
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos, posToOffset, posToOffsetOrZero } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export type OnExternalReferenceCallback = (location: ReferenceLocation) => void;

export type ReferencesRenderer = Renderer<
  [
    references: LSP.Location[],
    goToReference: (ref: LSP.Location) => void,
    onClose: () => void,
    kind: ReferenceKind,
  ]
>;

/**
 * The different kinds of language server textDocument/* reference.
 *
 * These all have generally similar behavior, but the kind to use depends on the
 * context of the request. For example, "textDocument/definition" is used for
 * going to a definition, while "textDocument/references" is used for finding
 * all references to a symbol regardless of whether you can jump to them.
 **/
export type ReferenceKind =
  | "textDocument/definition"
  | "textDocument/typeDefinition"
  | "textDocument/implementation"
  | "textDocument/references";

export interface ReferenceExtensionsArgs {
  /** Shortcuts for getting a references list. */
  showReferenceShortcuts?: KeyBinding[];
  /** Shortcuts for getting a reference list, but if there is only one option, you automatically hop to it. */
  goToDefinitionShortcuts?: KeyBinding[];
  /** Whether to allow Control/Meta followed by a left click to go to definition. */
  modClickForDefinition?: boolean;
  /** Callback for when an external reference is clicked. */
  onExternalReference?: OnExternalReferenceCallback;
  render?: ReferencesRenderer;
}

export type ReferenceLocation = {
  uri: string;
  range: LSP.Range;
  text?: string;
};

/** Human-readable labels for reference kinds */
export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  "textDocument/definition": "Definitions",
  "textDocument/typeDefinition": "Type Definitions",
  "textDocument/implementation": "Implementations",
  "textDocument/references": "References",
} as const;

export const getReferencesExtensions: LSExtensionGetter<
  ReferenceExtensionsArgs
> = ({
  showReferenceShortcuts: shortcuts = [{ key: "Shift-F12" }],
  goToDefinitionShortcuts = [{ key: "F12" }],
  modClickForDefinition = false,
  onExternalReference,
  render,
}) => {
  const extensions: Extension[] = [referencePanel];

  extensions.push(
    keymap.of([
      ...shortcuts.map((shortcut) => ({
        ...shortcut,
        // doesn't take an async function unfortunately, so we just always eat the keypress
        run: (view: EditorView) => {
          void handleFindReferences({
            view,
            render,
            kind: "textDocument/references",
          });
          return true;
        },
        preventDefault: true,
      })),
      ...goToDefinitionShortcuts.map((shortcut) => ({
        ...shortcut,
        run: (view: EditorView) => {
          void handleFindReferences({
            view,
            render,
            kind: "textDocument/definition",
            goToIfOneOption: true,
            onExternalReference,
          });
          return true;
        },
        preventDefault: true,
      })),
      { key: "Escape", run: closeReferencePanel },
    ]),
  );

  if (modClickForDefinition) {
    extensions.push(
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (event.button !== 0) return false;
          if (event.detail > 1) return false;

          if (event.ctrlKey || event.metaKey) {
            void handleFindReferences({
              view,
              render,
              kind: "textDocument/definition",
              goToIfOneOption: true,
              pos:
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ||
                undefined,
              onExternalReference,
            });
            return true;
          }
          return false;
        },
      }),
    );
  }

  return extensions;
};

/**
 * Find references for a symbol at the given position and displays them.
 *
 * Uses a definition LSP method.
 *
 * @returns true if the references were found and displayed, false otherwise.
 */
export async function handleFindReferences({
  view,
  onExternalReference,
  pos,
  goToIfOneOption = false,
  render,
  kind = "textDocument/references",
}: {
  view: EditorView;
  onExternalReference?: OnExternalReferenceCallback;
  pos?: number;
  goToIfOneOption?: boolean;
  render?: ReferencesRenderer;
  kind?:
    | "textDocument/definition"
    | "textDocument/typeDefinition"
    | "textDocument/implementation"
    | "textDocument/references";
}): Promise<boolean> {
  const lsPlugin = LSCore.ofOrThrow(view);

  if (
    lsPlugin.client.capabilities &&
    !referencesOfKindSupported(lsPlugin.client.capabilities, kind)
  ) {
    showDialog(view, { label: "References not supported by language server" });
    return false;
  }

  pos ??= view.state.selection.main.head;
  const position = offsetToPos(view.state.doc, pos);

  try {
    const response = await lsPlugin.requestWithLock(kind, {
      textDocument: { uri: lsPlugin.documentUri },
      position,
      context: {
        includeDeclaration: true,
      },
    });

    const onNoneFound = () =>
      showDialog(view, { label: `No ${REFERENCE_KIND_LABELS[kind]} found` });

    if (response === null) {
      onNoneFound();
      return false;
    }

    const responseArr = Array.isArray(response) ? response : [response];

    if (responseArr.length === 0) {
      onNoneFound();
      return false;
    }

    const referenceLocations: ReferenceLocation[] = responseArr
      .filter((loc): loc is LSP.Location | LSP.LocationLink => loc !== null)
      .map((loc: LSP.Location | LSP.LocationLink) => ({
        uri: "uri" in loc ? loc.uri : loc.targetUri,
        range: "range" in loc ? loc.range : loc.targetRange,
      }));

    if (referenceLocations.length === 1 && goToIfOneOption) {
      const ref = referenceLocations[0];
      if (!ref) {
        showDialog(view, {
          label: `No ${REFERENCE_KIND_LABELS[kind]} found`,
        });
        return false;
      }

      if (ref.uri !== lsPlugin.documentUri) {
        onExternalReference?.(ref);
        return false;
      }
      hopToDefinition({
        view,
        range: ref.range,
      });
      return false;
    }
    displayReferences(
      view,
      referenceLocations,
      lsPlugin.documentUri,
      kind,
      onExternalReference,
      render,
    );
  } catch (error) {
    showDialog(view, {
      label: `Find references failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }

  return true;
}

/** Whether a navigation to a spot in the editor was a result of a go to definition. */
export const wasScrollToDefinition = Annotation.define<boolean>();

/**
 * Navigate to the definition of a symbol in an EditorView.
 */
export function hopToDefinition({
  view,
  range,
}: {
  view: EditorView;
  range: LSP.Range;
}) {
  view.dispatch(
    view.state.update({
      selection: {
        anchor: posToOffsetOrZero(view.state.doc, range.start),
        head: posToOffset(view.state.doc, range.end),
      },
      scrollIntoView: true,
      annotations: [wasScrollToDefinition.of(true)],
    }),
  );
}

/**
 * Closes the reference panel if it is open.
 *
 * @returns true if the panel was closed, false if it was not open.
 */
export const closeReferencePanel: Command = (view) => {
  if (!view.state.field(referencePanel, false)) return false;
  view.dispatch({ effects: setReferencePanel.of(null) });
  return true;
};

const referencePanel = StateField.define<PanelConstructor | null>({
  create() {
    return null;
  },

  update(panel, tr) {
    for (const e of tr.effects) {
      if (e.is(setReferencePanel)) return e.value;
    }
    return panel;
  },

  provide: (f) => showPanel.from(f),
});

const setReferencePanel = StateEffect.define<PanelConstructor | null>();

function displayReferences(
  view: EditorView,
  locs: readonly ReferenceLocation[],
  documentUri: string,
  kind: ReferenceKind,
  onExternalReference?: OnExternalReferenceCallback,
  render?: ReferencesRenderer,
) {
  const panel = createReferencePanel(
    locs,
    documentUri,
    kind,
    onExternalReference,
    render,
  );
  const effect =
    view.state.field(referencePanel, false) === undefined
      ? StateEffect.appendConfig.of(referencePanel.init(() => panel))
      : setReferencePanel.of(panel);
  view.dispatch({ effects: effect });
}

function createReferencePanel(
  locs: readonly ReferenceLocation[],
  documentUri: string,
  kind: ReferenceKind,
  onExternalReference?: OnExternalReferenceCallback,
  render?: ReferencesRenderer,
): PanelConstructor {
  return (view) => {
    const locations: LSP.Location[] = locs.map((loc) => ({
      uri: loc.uri,
      range: loc.range,
    }));

    const goToReference = (ref: LSP.Location) => {
      if (ref.uri !== documentUri) {
        onExternalReference?.(ref);
        closeReferencePanel(view);
        return;
      }

      const startPos = posToOffset(view.state.doc, ref.range.start);
      const endPos = posToOffset(view.state.doc, ref.range.end);

      if (startPos && endPos) {
        view.dispatch({
          selection: { anchor: startPos, head: endPos },
          scrollIntoView: true,
        });
        closeReferencePanel(view);
      }
    };

    const onClose = () => closeReferencePanel(view);

    const panel = document.createElement("div");
    panel.classList.add("cm-lsp-references-panel");
    panel.setAttribute("aria-label", `${REFERENCE_KIND_LABELS[kind]} list`);

    const dom = document.createElement("div");
    dom.classList.add("cm-lsp-references-panel");
    dom.appendChild(panel);
    render?.(dom, locations, goToReference, onClose, kind);

    return {
      dom,
      mount: () => panel.focus(),
    };
  };
}

/**
 * Checks if the given reference kind is supported by the language server.
 */
export function referencesOfKindSupported(
  ServerCapabilities: LSP.ServerCapabilities,
  kind: ReferenceKind,
): boolean {
  const capabilityMap: Record<ReferenceKind, keyof LSP.ServerCapabilities> = {
    "textDocument/definition": "definitionProvider",
    "textDocument/typeDefinition": "typeDefinitionProvider",
    "textDocument/implementation": "implementationProvider",
    "textDocument/references": "referencesProvider",
  };

  const capability = capabilityMap[kind];

  return capability && ServerCapabilities?.[capability] === true;
}
