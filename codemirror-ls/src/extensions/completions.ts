import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import {
  autocompletion,
  insertCompletionText,
  snippet,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import {
  getCompletionTriggerKind,
  isEmptyDocumentation,
  offsetToPos,
  posToOffset,
  posToOffsetOrZero,
  prefixMatch,
} from "../utils.js";
import type { LSExtensionGetter } from "./types.js";

export interface CompletionExtensionsArgs {
  render: CompletionRenderer;
  completionMatchBefore?: RegExp;
}

export type CompletionRenderer = (
  element: HTMLElement,
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[] | string,
) => Promise<void>;

export const getCompletionsExtensions: LSExtensionGetter<
  CompletionExtensionsArgs
> = ({ render, completionMatchBefore }) => {
  return [
    autocompletion({
      override: [
        async (context: CompletionContext) => {
          if (!context.view) return null;
          const lsPlugin = LSCore.ofOrThrow(context.view);

          return await handleCompletion({
            context,
            lsPlugin,
            render,
            completionMatchBefore,
          });
        },
      ],
    }),
  ];
};

async function handleCompletion({
  context,
  lsPlugin,
  render,
  completionMatchBefore,
}: {
  context: CompletionContext;
  lsPlugin: LSCore;
  render: CompletionRenderer;
  completionMatchBefore?: RegExp;
}) {
  const { state, pos } = context;

  const result = getCompletionTriggerKind(
    context,
    lsPlugin.client.capabilities?.completionProvider?.triggerCharacters ?? [],
    completionMatchBefore,
  );

  if (result == null) return null;

  const position = offsetToPos(state.doc, pos);

  if (!lsPlugin.client.ready) return null;
  if (!lsPlugin.client.capabilities?.completionProvider) return null;

  const completionResult = await lsPlugin.doWithLock(async () => {
    return await lsPlugin.requestWithLock("textDocument/completion", {
      textDocument: { uri: lsPlugin.documentUri },
      position: { line: position.line, character: position.character },
      context: {
        triggerKind: result.triggerKind,
        triggerCharacter: result.triggerCharacter,
      },
    });
  });

  if (!completionResult) {
    return null;
  }

  const items =
    "items" in completionResult ? completionResult.items : completionResult;

  // Match is undefined if there are no common prefixes
  const match = prefixMatch(items);

  const token = match
    ? context.matchBefore(match)
    : // Fallback to matching any character
      context.matchBefore(/[a-zA-Z0-9]+/);
  let { pos: completionPos } = context;

  const sortedItems = sortCompletionItems(items, token?.text);

  // If we found a token that matches our completion pattern
  if (token) {
    // Set position to the start of the token
    completionPos = token.from;
  }

  const options = sortedItems.map((item) => {
    return toCodemirrorCompletion(item, {
      hasResolveProvider:
        lsPlugin.client.capabilities?.completionProvider?.resolveProvider ??
        false,
      resolveItem: async (item: LSP.CompletionItem) => {
        return (await lsPlugin.requestWithLock(
          "completionItem/resolve",
          item,
        ))!;
      },
      render,
    });
  });

  return {
    from: completionPos,
    options,
    filter: false,
  };
}

const CompletionItemKindMap = Object.fromEntries(
  Object.entries(LSP.CompletionItemKind).map(([key, value]) => [value, key]),
) as Record<LSP.CompletionItemKind, string>;

export function toCodemirrorSnippet(snippet: string): string {
  // Remove double backslashes
  const result = snippet.replaceAll(/\\\\/g, "");

  // Braces are required in CodeMirror syntax
  return result.replaceAll(
    /(\$(\d+))/g,
    // biome-ignore lint/style/useTemplate: reads better
    (_match, _p1, p2) => "${" + p2 + "}",
  );
}

export function toCodemirrorCompletion(
  item: LSP.CompletionItem,
  options: {
    hasResolveProvider: boolean;
    resolveItem: (item: LSP.CompletionItem) => Promise<LSP.CompletionItem>;
    render: CompletionRenderer;
  },
): Completion {
  let {
    detail,
    labelDetails,
    label,
    kind,
    textEdit,
    insertText,
    documentation,
    additionalTextEdits,
  } = item;

  const { render } = options;

  let detailStr: undefined | string;
  if (labelDetails) {
    if (labelDetails.detail) {
      detailStr += labelDetails.detail;
    }
    if (labelDetails.description) {
      detailStr += labelDetails.description;
    }
  } else if (detail) {
    detailStr = detail;
  }

  const completion: Completion = {
    label,
    detail: detailStr,
    apply(view: EditorView, _completion: Completion, from: number, to: number) {
      if (textEdit) {
        if (LSP.TextEdit.is(textEdit)) {
          view.dispatch(
            insertCompletionText(
              view.state,
              textEdit.newText.replace(/\$1/g, ""),
              posToOffsetOrZero(view.state.doc, textEdit.range.start),
              posToOffsetOrZero(view.state.doc, textEdit.range.end),
            ),
          );
        } else if (LSP.InsertReplaceEdit.is(textEdit)) {
          const { insert, replace } = textEdit;
          const insertFrom = posToOffsetOrZero(view.state.doc, insert.start);
          const insertTo = posToOffsetOrZero(view.state.doc, insert.end);
          const replaceFrom = posToOffsetOrZero(view.state.doc, replace.start);
          const replaceTo = posToOffsetOrZero(view.state.doc, replace.end);

          const insertedText = textEdit.newText
            .replace(/\$1/g, "")
            .replace(/\$0/g, "");

          view.dispatch({
            changes: [
              {
                from: insertFrom,
                to: insertTo,
                insert: insertedText,
              },
              {
                from: replaceFrom,
                to: replaceTo,
                insert: "",
              },
            ],
            selection: {
              anchor: insertFrom + insertedText.length,
            },
          });
        }
      } else {
        if (insertText) {
          const applySnippet = snippet(toCodemirrorSnippet(insertText));
          applySnippet(view, null, from, to);
        } else {
          // By default it is PlainText
          view.dispatch(
            insertCompletionText(view.state, insertText || label, from, to),
          );
        }
      }

      if (!additionalTextEdits) {
        return;
      }

      const sortedEdits = additionalTextEdits.sort(
        ({ range: { end: a } }, { range: { end: b } }) => {
          if (
            posToOffsetOrZero(view.state.doc, a) <
            posToOffsetOrZero(view.state.doc, b)
          ) {
            return 1;
          }
          if (
            posToOffsetOrZero(view.state.doc, a) >
            posToOffsetOrZero(view.state.doc, b)
          ) {
            return -1;
          }
          return 0;
        },
      );

      for (const textEdit of sortedEdits) {
        view.dispatch(
          view.state.update({
            changes: {
              from: posToOffsetOrZero(view.state.doc, textEdit.range.start),
              to: posToOffset(view.state.doc, textEdit.range.end),
              insert: textEdit.newText,
            },
          }),
        );
      }
    },
    type: kind && CompletionItemKindMap[kind].toLowerCase(),
  };

  // Support lazy loading of documentation through completionItem/resolve
  if (options.hasResolveProvider && options.resolveItem) {
    completion.info = async () => {
      try {
        const resolved = await options.resolveItem?.(item);
        // From capabilities:
        // > resolveSupport: {
        // >   properties: ["documentation", "detail", "additionalTextEdits"],
        // > },
        documentation = resolved?.documentation || documentation;
        detail = resolved?.detail || detail;
        additionalTextEdits =
          resolved?.additionalTextEdits || additionalTextEdits;

        const content = resolved?.documentation || documentation;

        if (resolved.detail) {
          detailStr = resolved.detail;
        }

        if (resolved.labelDetails) {
          if (resolved.labelDetails.detail) {
            detailStr += resolved.labelDetails.detail;
          }
          if (resolved.labelDetails.description) {
            detailStr += resolved.labelDetails.description;
          }
        }

        if (!content) return null;
        if (isEmptyDocumentation(content)) return null;

        const dom = document.createElement("div");
        dom.classList.add("cm-lsp-completion-documentation");
        await render(dom, content);

        return dom;
      } catch {
        if (isEmptyDocumentation(documentation)) return null;
        // Fallback to existing documentation if resolve fails
        if (documentation) {
          const dom = document.createElement("div");
          dom.classList.add("cm-lsp-completion-documentation");
          await render(dom, documentation);
          return dom;
        }
        return null;
      }
    };
  } else if (documentation) {
    // Fallback for servers without resolve support
    completion.info = async () => {
      const dom = document.createElement("div");
      dom.classList.add("cm-lsp-completion-documentation");

      let documentationStr = "";
      if (typeof documentation === "string") {
        documentationStr = documentation;
      } else {
        documentationStr = documentation?.value || "";
      }

      await render(dom, documentationStr);
      return dom;
    };
  }

  return completion;
}

export function sortCompletionItems(
  items: LSP.CompletionItem[],
  matchBefore: string | undefined,
): LSP.CompletionItem[] {
  // Create an array of sort functions to apply in order
  const sortFunctions = [
    // First prioritize preselected items
    (a: LSP.CompletionItem, b: LSP.CompletionItem) => {
      if (a.preselect && !b.preselect) return -1;
      if (!a.preselect && b.preselect) return 1;
      return 0;
    },
    // Then prioritize items by sortText (or label if sortText is missing)
    (a: LSP.CompletionItem, b: LSP.CompletionItem) => {
      const aText = a.sortText ?? a.label;
      const bText = b.sortText ?? b.label;
      return aText.localeCompare(bText);
    },
    // If matchBefore exists, prioritize items that match the prefix
    ...(matchBefore ? [prefixSortCompletion(matchBefore)] : []),
  ];

  let result = items;

  // If we found a token that matches our completion pattern
  if (matchBefore) {
    const word = matchBefore.toLowerCase();
    // Only filter and sort for word characters
    if (/^\w+$/.test(word)) {
      // Filter items to only include those that start with the current word
      result = result.filter(({ label, filterText, textEdit }) => {
        if (textEdit) return true; // Always include snippets. TODO: This should be done at the LSP side

        const text = filterText ?? label;
        return text.toLowerCase().startsWith(word);
      });
    }
  }

  for (const sortFunction of sortFunctions) {
    result.sort(sortFunction);
  }

  return result;
}

function prefixSortCompletion(prefix: string) {
  // Sort completion items:
  // 1. Prioritize items that start with the exact token text
  // 2. Otherwise maintain original order
  return (a: LSP.CompletionItem, b: LSP.CompletionItem) => {
    const aText = a.sortText ?? a.label;
    const bText = b.sortText ?? b.label;
    switch (true) {
      case aText.startsWith(prefix) && !bText.startsWith(prefix):
        return -1;
      case !aText.startsWith(prefix) && bText.startsWith(prefix):
        return 1;
    }
    return aText.localeCompare(bText);
  };
}
