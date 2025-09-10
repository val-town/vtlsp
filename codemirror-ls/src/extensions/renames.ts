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
  /** Function to render the rename dialog. */
  render: RenameRenderer;
  /**
   * Whether to select the symbol at the cursor when initiating a rename.
   * Defaults to `true`.
   */
  selectSymbol?: boolean;
  /**
   * Whether to reset the symbol selection after completing or dismissing
   * the rename action. Defaults to `true`.
   */
  resetSymbolSelection?: boolean;
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
  render,
  selectSymbol = true,
  resetSymbolSelection = true,
}: RenameExtensionsArgs): Extension[] => {
  const renameDialogField = StateField.define<Tooltip | null>({
    create() {
      return null;
    },
    update(tooltip, tr) {
      const rename = tr.annotation(symbolRename);

      if (rename === null) return null;

      if (rename) {
        return {
          create: (view) => {
            const onComplete = async (newName: string) => {
              const lsPlugin = LSCore.ofOrThrow(view);
              const pos = offsetToPos(view.state.doc, rename.pos);

              const edit = await lsPlugin.client.request(
                "textDocument/rename",
                {
                  textDocument: { uri: lsPlugin.documentUri },
                  position: { line: pos.line, character: pos.character },
                  newName,
                },
              );

              if (!edit) return;

              void lsPlugin.applyWorkspaceEdit(edit);
            };

            const onDismiss = () => {
              view.dispatch({
                selection: resetSymbolSelection
                  ? { anchor: view.state.selection.main.head }
                  : view.state.selection,
                annotations: [symbolRename.of(null)],
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
    keymap.of(
      (shortcuts || []).map((shortcut) => ({
        ...shortcut,
        run: (view: EditorView) => {
          void handleRename({
            view,
            pos: view.state.selection.main.head,
            selectSymbol,
          });
          return true;
        },
      })),
    ),
    renameDialogField,
  ];
};

/** When the language server responds with information so that the user can rename a symbol */
const symbolRename = Annotation.define<{
  pos: number;
  placeholder: string;
} | null>();

export async function handleRename({
  view,
  pos,
  selectSymbol = true,
}: {
  view: EditorView;
  pos: number;
  selectSymbol?: boolean;
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
    selection: selectSymbol
      ? EditorSelection.create([
          EditorSelection.range(
            posToOffset(view.state.doc, range.start)!,
            posToOffset(view.state.doc, range.end)!,
          ),
        ])
      : view.state.selection,
    annotations: symbolRename.of({
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
