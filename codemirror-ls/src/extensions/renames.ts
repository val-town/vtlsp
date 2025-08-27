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

import {
  Annotation,
  EditorSelection,
  type Extension,
  StateField,
} from "@codemirror/state";
import type { EditorView, KeyBinding, Tooltip } from "@codemirror/view";
import { keymap, showTooltip } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos, posToOffset } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface RenameExtensionsArgs {
  /** Keybindings to trigger the rename action. */
  shortcuts?: KeyBinding[];
  /** Callback for when a rename is received that affects other (non active) files. */
  onExternalRename?: OnExternalRenameCallback;
  /** Callback for when a rename is received. */
  onRename?: OnRenameCallback;
  /** Renderer for the rename UI. */
  render: RenameRenderer;
}

export type RenameRenderer = Renderer<
  [
    placeholder: string,
    onDismiss: () => void,
    onComplete: (newName: string) => void,
  ]
>;

export type OnRenameCallback = (
  uri: string,
  rename: LSP.TextDocumentEdit,
) => void;
export type OnExternalRenameCallback = OnRenameCallback;

/**
 * Creates and returns extensions for handling renaming functionality
 */
export const getRenameExtensions: LSExtensionGetter<RenameExtensionsArgs> = ({
  shortcuts,
  onExternalRename,
  onRename,
  render,
}: RenameExtensionsArgs): Extension[] => {
  const renameDialogField = StateField.define<Tooltip | null>({
    create() {
      return null;
    },
    update(tooltip, tr) {
      const rename = tr.annotation(renameActivated);

      if (rename === null) return null;

      if (rename) {
        return {
          create: (view) => {
            const onComplete = (newName: string) => {
              const lsPlugin = LSCore.ofOrThrow(view);
              const pos = offsetToPos(view.state.doc, rename.pos);

              lsPlugin.client
                .request("textDocument/rename", {
                  textDocument: { uri: lsPlugin.documentUri },
                  position: { line: pos.line, character: pos.character },
                  newName,
                })
                .then((edit) => {
                  if (!edit) return;

                  // If the rename is in this document, apply it directly
                  if (LSP.WorkspaceEdit.is(edit)) {
                    let changes: LSP.TextEdit[] | undefined;
                    if ("changes" in edit) {
                      changes = edit.changes?.[lsPlugin.documentUri];
                    } else if ("documentChanges" in edit) {
                      changes = edit.documentChanges!.flatMap((change) =>
                        LSP.TextDocumentEdit.is(change) ? change.edits : [],
                      );
                    }

                    if (changes) {
                      view.dispatch({
                        changes: changes.map((change) => ({
                          from: posToOffset(
                            view.state.doc,
                            change.range.start,
                          )!,
                          to: posToOffset(view.state.doc, change.range.end)!,
                          insert: change.newText,
                        })),
                      });
                    }
                  }

                  if (LSP.TextDocumentEdit.is(edit)) {
                    onRename?.(lsPlugin.documentUri, edit);
                    if (edit.textDocument.uri !== lsPlugin.documentUri) {
                      onExternalRename?.(lsPlugin.documentUri, edit);
                    }
                  } else if (LSP.WorkspaceEdit.is(edit)) {
                    if (edit.documentChanges) {
                      for (const change of edit.documentChanges) {
                        if (LSP.TextDocumentEdit.is(change)) {
                          onRename?.(lsPlugin.documentUri, change);
                        }
                      }
                    }
                  }
                });
            };

            const onDismiss = () => {
              view.dispatch({
                annotations: [renameActivated.of(null)],
              });
            };

            const div = document.createElement("div");
            void render(div, rename.placeholder, onDismiss, onComplete);

            return {
              dom: div,
              above: false,
              strictSide: true,
            };
          },
          pos: rename.pos,
        };
      }

      return tooltip;
    },
    provide: (field) => {
      return showTooltip.compute([field], (state) => state.field(field));
    },
  });

  return [
    renameDialogField,
    keymap.of(
      (shortcuts || []).map((shortcut) => ({
        ...shortcut,
        run: (view: EditorView) => {
          view.dispatch({
            annotations: renameAttempted.of(
              view.state.wordAt(view.state.selection.main.head)?.from || 0,
            ),
          });
          return true;
        },
      })),
    ),
  ];
};

/** When the language server responds with information so that the user can rename a symbol */
const renameActivated = Annotation.define<{
  pos: number;
  placeholder: string;
} | null>();

/** When a user attempts to rename a symbol, but before specifying what to */
const renameAttempted = Annotation.define<number>();

export async function handleRename({
  view,
  pos,
}: {
  view: EditorView;
  pos: number;
}) {
  const lsPlugin = LSCore.ofOrThrow(view);

  // Gather information about the rename location and maybe the placeholder to
  // show in the dialog
  // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_prepareRename

  const word = view.state.wordAt(pos);
  if (!word) return;

  let prepareResult: LSP.PrepareRenameResult | null = null;

  // Attempt to use textDocument/prepareRename, which may not be a thing
  try {
    const realPrepareResult = await lsPlugin.client.request(
      "textDocument/prepareRename",
      {
        textDocument: { uri: lsPlugin.documentUri },
        position: offsetToPos(view.state.doc, pos)!,
      },
    );
    if (realPrepareResult) {
      prepareResult = realPrepareResult;
    }
  } catch {
    const positionData = offsetToPos(view.state.doc, pos);
    const fallbackResult = prepareRenameFallback({
      view,
      character: positionData.character,
      line: positionData.line,
    });
    prepareResult = fallbackResult;
  }

  if (!prepareResult) return;

  // Handle different types of PrepareRenameResult
  let placeholder: string;
  let range: LSP.Range;

  if (LSP.Range.is(prepareResult)) {
    // If it's just a Range, use the word text as placeholder
    range = prepareResult;
    const start = posToOffset(view.state.doc, range.start)!;
    const end = posToOffset(view.state.doc, range.end)!;
    placeholder = view.state.doc.sliceString(start, end);
  } else if ("range" in prepareResult && "placeholder" in prepareResult) {
    // It's a PrepareRename with placeholder and range
    placeholder = prepareResult.placeholder;
    range = prepareResult.range;
  } else if ("defaultBehavior" in prepareResult) {
    // Server indicated to use default behavior, use the word range
    const wordRange = view.state.wordAt(pos);
    if (!wordRange) return;
    const posData = offsetToPos(view.state.doc, pos);
    range = {
      start: {
        line: posData.line,
        character: posData.character - (pos - wordRange.from),
      },
      end: {
        line: posData.line,
        character: posData.character + (wordRange.to - pos),
      },
    };
    placeholder = view.state.doc.sliceString(wordRange.from, wordRange.to);
  } else {
    return; // Unknown format
  }

  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.range(
        posToOffset(view.state.doc, range.start)!,
        posToOffset(view.state.doc, range.end)!,
      ),
    ]),
    annotations: renameActivated.of({
      placeholder,
      pos: posToOffset(view.state.doc, range.start)!,
    }),
  });
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
