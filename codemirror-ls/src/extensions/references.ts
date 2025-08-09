import type * as LSP from "vscode-languageserver-protocol";
import {
  type Command,
  EditorView,
  type KeyBinding,
  showPanel,
  type PanelConstructor,
  keymap,
  showDialog,
} from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { offsetToPos, posToOffset, posToOffsetOrZero } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";
import { LSCore } from "../LSPlugin.js";

export type OnExternalReferenceCallback = (location: ReferenceLocation) => void;

export type ReferencesRenderer = Renderer<
  [
    references: LSP.Location[],
    goToReference: (ref: LSP.Location) => void,
    onClose: () => void,
    kind: ReferenceKind,
  ]
>;

/** The different kinds of language server textDocument/* reference. */
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
export const REFERENCE_KIND_LABELS = {
  "textDocument/definition": "Definitions",
  "textDocument/typeDefinition": "Type Definitions",
  "textDocument/implementation": "Implementations",
  "textDocument/references": "References",
};

/**
 * Get extensions for go to definition, type definition, implementation, and
 * view all references.
 */
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
        run: (view: EditorView) => {
          return handleFindReferences({
            view,
            render,
            kind: "textDocument/references",
          });
        },
        preventDefault: true,
      })),
      ...goToDefinitionShortcuts.map((shortcut) => ({
        ...shortcut,
        run: (view: EditorView) => {
          return handleFindReferences({
            view,
            render,
            kind: "textDocument/definition",
            goToIfOneOption: true,
            onExternalReference,
          });
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
            return handleFindReferences({
              view,
              render,
              kind: "textDocument/definition",
              goToIfOneOption: true,
              pos:
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ||
                undefined,
              onExternalReference,
            });
          }
          return false;
        },
      }),
    );
  }

  return extensions;
};

export function handleFindReferences({
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
}): boolean {
  const lsPlugin = LSCore.ofOrThrow(view);

  if (!lsPlugin.client.capabilities?.referencesProvider) {
    showDialog(view, { label: "References not supported by language server" });
    return false;
  }

  pos ??= view.state.selection.main.head;
  const position = offsetToPos(view.state.doc, pos);

  lsPlugin
    .requestWithLock(kind, {
      textDocument: { uri: lsPlugin.documentUri },
      position,
      context: {
        includeDeclaration: true,
      },
    })
    .then((response) => {
      const onNoneFound = () =>
        showDialog(view, { label: `No ${REFERENCE_KIND_LABELS[kind]} found` });

      if (response === null) {
        onNoneFound();
        return;
      }

      const responseArr = Array.isArray(response) ? response : [response];

      if (responseArr.length === 0) {
        onNoneFound();
        return;
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
          showDialog(view, { label: `No ${REFERENCE_KIND_LABELS[kind]} found` });
          return;
        }

        if (ref.uri !== lsPlugin.documentUri) {
          onExternalReference?.(ref);
          return;
        }
        hopToDefinition({
          view,
          range: ref.range,
        });
        return;
      } else {
        displayReferences(
          view,
          referenceLocations,
          lsPlugin.documentUri,
          kind,
          onExternalReference,
          render,
        );
      }
    })
    .catch((error) => {
      showDialog(view, {
        label: `Find references failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    });

  return true;
}

function hopToDefinition({
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
    }),
  );
}

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
    for (let e of tr.effects) {
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
        view.focus();
        view.dispatch({
          selection: { anchor: startPos, head: endPos },
          scrollIntoView: true,
        });
        closeReferencePanel(view);
      }
    };

    const onClose = () => closeReferencePanel(view);

    const panel = document.createElement("div");
    panel.setAttribute("aria-label", `${REFERENCE_KIND_LABELS[kind]} list`);

    const dom = document.createElement("div");
    dom.appendChild(panel);
    render?.(dom, locations, goToReference, onClose, kind);

    return {
      dom,
      mount: () => panel.focus(),
    };
  };
}
