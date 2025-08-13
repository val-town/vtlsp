import type { CompletionContext } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";

export function posToOffset(
  doc: Text,
  pos: { line: number; character: number },
): number | undefined {
  if (pos.line >= doc.lines) {
    // Next line (implying the end of the document)
    if (pos.character === 0) {
      return doc.length;
    }
    return;
  }
  const offset = doc.line(pos.line + 1).from + pos.character;
  if (offset > doc.length) {
    return;
  }
  return offset;
}

export function posToOffsetOrZero(
  doc: Text,
  pos: { line: number; character: number },
): number {
  return posToOffset(doc, pos) || 0;
}

export function offsetToPos(
  doc: Text,
  offset: number,
): { character: number; line: number } {
  const line = doc.lineAt(offset);
  return {
    character: offset - line.from,
    line: line.number - 1,
  };
}

export function defaultContentFormatter(
  contents:
    | LSP.MarkupContent
    | LSP.MarkedString
    | LSP.MarkedString[]
    | undefined,
): HTMLElement {
  const element = document.createElement("div");
  if (!contents) {
    return element;
  }
  if (isLSPMarkupContent(contents)) {
    element.innerText = contents.value;
    return element;
  }
  if (Array.isArray(contents)) {
    contents
      .map((c) => defaultContentFormatter(c))
      .filter(Boolean)
      .forEach((child) => element.appendChild(child));
    return element;
  }
  if (typeof contents === "string") {
    element.innerText = contents;
    return element;
  }
  return element;
}

/**
 * Finds the longest common prefix among an array of strings.
 *
 * @param strs - Array of strings to analyze
 * @returns The longest common prefix string
 */
function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  if (strs.length === 1) return strs[0] || "";

  // Sort the array
  strs.sort();

  // Get the first and last string after sorting
  const firstStr = strs[0] || "";
  const lastStr = strs[strs.length - 1] || "";

  // Find the common prefix between the first and last string
  let i = 0;
  while (i < firstStr.length && firstStr[i] === lastStr[i]) {
    i++;
  }

  return firstStr.substring(0, i);
}

/**
 * Analyzes completion items to generate a regex pattern for matching prefixes.
 * Used to determine what text should be considered part of the current token
 * when filtering completion items.
 *
 * @param items - Array of LSP completion items to analyze
 * @returns A RegExp object that matches anywhere in a string
 */
export function prefixMatch(items: LSP.CompletionItem[]) {
  if (items.length === 0) {
    return undefined;
  }

  const labels = items.map((item) => item.textEdit?.newText || item.label);
  const prefix = longestCommonPrefix(labels);

  if (prefix === "") {
    return undefined;
  }

  const explodedPrefixes: string[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const slice = prefix.slice(0, i + 1);
    if (slice.length > 0) {
      // Escape special regex characters to avoid pattern errors
      const escapedSlice = slice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      explodedPrefixes.push(escapedSlice);
    }
  }
  const orPattern = explodedPrefixes.join("|");
  // Create regex pattern that matches the common prefix for each possible prefix by dropping the last character
  const pattern = new RegExp(`(${orPattern})$`);

  return pattern;
}

export function isLSPMarkupContent(
  contents: LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[],
): contents is LSP.MarkupContent {
  return (
    (contents as LSP.MarkupContent).kind !== undefined || // TODO: Make sure this check is right
    (contents as LSP.MarkupContent).value !== undefined
  );
}

export function isEmptyDocumentation(
  documentation:
    | LSP.MarkupContent
    | LSP.MarkedString
    | LSP.MarkedString[]
    | undefined,
) {
  if (documentation == null) {
    return true;
  }
  if (Array.isArray(documentation)) {
    return (
      documentation.length === 0 || documentation.every(isEmptyDocumentation)
    );
  }
  if (typeof documentation === "string") {
    return isEmptyIshValue(documentation);
  }
  const value = documentation.value;
  if (typeof value === "string") {
    return isEmptyIshValue(value);
  }
  return false;
}

function isEmptyIshValue(value: unknown) {
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    // Empty string or string with only whitespace or backticks
    return value.trim() === "" || /^[\s\n`]*$/.test(value);
  }
  return false;
}

/**
 * Check if a given range is within the current document bounds.
 *
 * @param range The range to check.
 * @param view The editor view containing the document.
 * @returns Whether the range is within the document bounds.
 */
export function isInCurrentDocumentBounds(
  range: LSP.Range,
  view: EditorView,
): boolean {
  const { start, end } = range;
  return (
    start.line >= 0 &&
    end.line < view.state.doc.lines &&
    start.character >= 0 &&
    end.character <= view.state.doc.lineAt(end.line).length
  );
}
