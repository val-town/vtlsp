/**
 * @module renames
 * @description Extensions for handling renaming of symbols in the editor.
 *
 * Renaming allows users to change the name of a symbol across the codebase.
 * This is a "refactor" operation that updates all references to the symbol
 * in the current document and potentially across multiple files.
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_rename
 */

import { Annotation, type Extension } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { getDialog, keymap, showDialog } from "@codemirror/view";
import type * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos, posToOffset } from "../utils.js";
import type { LSExtensionGetter } from "./types.js";

export interface RenameExtensionsArgs {
  /** Keybindings to trigger the rename action. */
  shortcuts?: KeyBinding[];
  /** Callback for when a rename is received that affects other (non active) files. */
  onExternalRename?: OnExternalRenameCallback;
  /** Callback for when a rename is received. */
  onRename?: OnRenameCallback;
}

export type OnRenameCallback = (
  rename:
    | LSP.TextDocumentEdit
    | LSP.CreateFile
    | LSP.RenameFile
    | LSP.DeleteFile,
) => void;
export type OnExternalRenameCallback = OnRenameCallback;

export const getRenameExtensions: LSExtensionGetter<RenameExtensionsArgs> = ({
  shortcuts = [],
  onExternalRename,
  onRename,
}: RenameExtensionsArgs): Extension[] => {
  return [
    keymap.of(
      shortcuts.map((shortcut) => ({
        ...shortcut,
        run: (view: EditorView) => {
          void handleRename({
            // unfortunately we can't take async, so we always eat the keybind
            view,
            renameEnabled: true,
            onExternalRename,
            onRename,
          });
          return true;
        },
      })),
    ),
  ];
};

/**
 * Handles the renaming of a symbol in the editor.
 */
export async function handleRename({
  view,
  renameEnabled = true,
  onExternalRename,
  onRename,
  pos,
}: {
  view: EditorView;
  renameEnabled?: boolean;
  onExternalRename?: OnExternalRenameCallback;
  onRename?: OnRenameCallback;
  pos?: number;
}): Promise<boolean> {
  if (!renameEnabled) return false;

  const lsPlugin = LSCore.ofOrThrow(view);

  pos ??= view.state.selection.main.head;
  const { line, character } = offsetToPos(view.state.doc, pos);
  await requestRename({
    view,
    line,
    character,
    documentUri: lsPlugin.documentUri,
    onExternalRename,
    onRename,
  });
  return true;
}

/**
 * Requests a rename operation from the language server.
 */
async function requestRename({
  view,
  line,
  character,
  documentUri,
  onExternalRename,
  onRename,
}: {
  view: EditorView;
  line: number;
  character: number;
  documentUri: string;
  onExternalRename?: OnExternalRenameCallback;
  onRename?: OnRenameCallback;
}) {
  const lsPlugin = LSCore.ofOrThrow(view);

  if (lsPlugin.client.capabilities?.renameProvider) {
    showDialog(view, { label: "Rename not supported by language server" });
    return;
  }

  try {
    await lsPlugin.doWithLock(async (doc) => {
      // First check if rename is possible at this position
      const prepareResult = await lsPlugin.client
        .request("textDocument/prepareRename", {
          textDocument: { uri: documentUri },
          position: { line, character },
        })
        .catch(() => {
          // In case prepareRename is not supported,
          // we fallback to the default implementation
          return prepareRenameFallback({
            view,
            line,
            character,
          });
        });

      if (!prepareResult || "defaultBehavior" in prepareResult) {
        showDialog(view, { label: "Cannot rename this symbol" });
        return;
      }

      // Get current word as default value
      const range =
        "range" in prepareResult ? prepareResult.range : prepareResult;
      const from = posToOffset(doc, range.start);
      if (from == null) {
        return;
      }
      const to = posToOffset(doc, range.end);
      const currentWord = doc.sliceString(from, to);

      // Check if dialog is already open
      const panel = getDialog(view, "cm-lsp-rename-panel");
      if (panel) {
        const input = panel.dom.querySelector(
          "[name=name]",
        ) as HTMLInputElement;
        input.classList.add("cm-lsp-rename-input");
        input.value = currentWord;
        input.select();
      } else {
        // Select the current word and show rename dialog
        view.dispatch({
          selection: {
            anchor: from,
            head: to,
          },
          scrollIntoView: true,
        });

        const { close, result } = showDialog(view, {
          label: "New name",
          input: { name: "name", value: currentWord },
          focus: true,
          submitLabel: "Rename",
        });

        result.then(async (form) => {
          view.dispatch({ effects: close });
          if (form) {
            const newName = (
              form.elements.namedItem("name") as HTMLInputElement
            ).value.trim();
            if (!newName) {
              showDialog(view, { label: "New name cannot be empty" });
              return;
            }

            if (newName === currentWord) {
              // No change -> do nothing
              return;
            }

            try {
              const edit = await lsPlugin.requestWithLock(
                "textDocument/rename",
                {
                  textDocument: { uri: documentUri },
                  position: { line, character },
                  newName,
                },
              );

              await applyRenameEdit(
                view,
                edit,
                documentUri,
                onExternalRename,
                onRename,
              );
            } catch (error) {
              showDialog(view, {
                label: `Rename failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              });
            }
          }
        });
      }
    });
  } catch (error) {
    showDialog(view, {
      label: `Rename failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

function prepareRenameFallback({
  view,
  line,
  character,
}: {
  view: EditorView;
  line: number;
  character: number;
}): LSP.PrepareRenameResult | null {
  const doc = view.state.doc;
  const lineText = doc.line(line + 1).text;
  const wordRegex = /\w+/g;
  let match: RegExpExecArray | null;
  let start = character;
  let end = character;

  // Find all word matches in the line
  match = wordRegex.exec(lineText);
  while (match !== null) {
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Check if cursor position is within or at the boundaries of this word
    if (character >= matchStart && character <= matchEnd) {
      start = matchStart;
      end = matchEnd;
      break;
    }
    match = wordRegex.exec(lineText);
  }

  if (start === character && end === character) {
    return null; // No word found at cursor position
  }

  return {
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
    placeholder: lineText.slice(start, end),
  };
}

/**
 * Annotation to mark transactions that apply rename edits.
 */
const wasRenameApplication = Annotation.define<boolean>();

/**
 * Handles the renaming of a symbol in the editor.
 */
export async function applyRenameEdit(
  view: EditorView,
  edit: LSP.WorkspaceEdit | null,
  documentUri: string,
  onExternalRename?: OnExternalRenameCallback,
  onRename?: OnRenameCallback,
): Promise<boolean> {
  if (!edit) {
    showDialog(view, { label: "No edit returned from language server" });
    return false;
  }

  const changesMap = edit.changes ?? {};
  const documentChanges = edit.documentChanges ?? [];

  if (Object.keys(changesMap).length === 0 && documentChanges.length === 0) {
    showDialog(view, { label: "No changes to apply" });
    return false;
  }

  // Handle documentChanges (preferred) if available
  if (documentChanges.length > 0) {
    for (const docChange of documentChanges) {
      if ("textDocument" in docChange) {
        // This is a TextDocumentEdit
        const uri = docChange.textDocument.uri;

        if (uri !== documentUri) {
          onExternalRename?.(docChange);
          continue;
        }

        onRename?.(docChange);

        // Sort edits in reverse order to avoid position shifts
        const sortedEdits = docChange.edits.sort((a, b) => {
          const posA = posToOffset(view.state.doc, a.range.start);
          const posB = posToOffset(view.state.doc, b.range.start);
          return (posB ?? 0) - (posA ?? 0);
        });

        // Create a single transaction with all changes
        const changes = sortedEdits.map((edit) => ({
          from: posToOffset(view.state.doc, edit.range.start) ?? 0,
          to: posToOffset(view.state.doc, edit.range.end) ?? 0,
          insert: edit.newText,
        }));

        view.dispatch(
          view.state.update({
            changes,
            annotations: wasRenameApplication.of(true),
          }),
        );
        return true;
      }

      // This is a CreateFile, RenameFile, or DeleteFile operation
      onExternalRename?.(docChange);
      showDialog(view, {
        label:
          "File creation, deletion, or renaming operations not supported yet",
      });
      return false;
    }
  } // Fall back to changes if documentChanges is not available
  else if (Object.keys(changesMap).length > 0) {
    // Apply all changes
    for (const [uri, changes] of Object.entries(changesMap)) {
      if (uri !== documentUri) {
        // Create a TextDocumentEdit for external files
        const textDocumentEdit: LSP.TextDocumentEdit = {
          textDocument: { uri, version: null },
          edits: changes,
        };
        onExternalRename?.(textDocumentEdit);
        continue;
      }

      // Create a TextDocumentEdit for current file
      const textDocumentEdit: LSP.TextDocumentEdit = {
        textDocument: { uri, version: null },
        edits: changes,
      };
      onRename?.(textDocumentEdit);

      // Sort changes in reverse order to avoid position shifts
      const sortedChanges = changes.sort((a, b) => {
        const posA = posToOffset(view.state.doc, a.range.start);
        const posB = posToOffset(view.state.doc, b.range.start);
        return (posB ?? 0) - (posA ?? 0);
      });

      // Create a single transaction with all changes
      const changeSpecs = sortedChanges.map((change) => ({
        from: posToOffset(view.state.doc, change.range.start) ?? 0,
        to: posToOffset(view.state.doc, change.range.end) ?? 0,
        insert: change.newText,
      }));

      view.dispatch(
        view.state.update({
          changes: changeSpecs,
          annotations: wasRenameApplication.of(true),
        }),
      );
    }
    return true;
  }
  return false;
}
