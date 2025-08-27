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
  pos,
}: {
  view: EditorView;
  renameEnabled?: boolean;
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
}: {
  view: EditorView;
  line: number;
  character: number;
  documentUri: string;
  onExternalRename?: OnExternalRenameCallback;
  onRename?: OnRenameCallback;
}) {
  const lsPlugin = LSCore.ofOrThrow(view);

  if (!lsPlugin.client.capabilities?.renameProvider) {
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

              if (edit) {
                void lsPlugin.applyWorkspaceEdit(edit);
              }
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