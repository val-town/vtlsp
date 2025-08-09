import {
  type CodeAction,
  type Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver-protocol";
import ts from "typescript";
import { intoReflexiveDiagnostic } from "./reflexiveDiagnostics.ts";

/**
 * Checks if a file contains JSX elements but is missing the required pragma
 * or is using JSX in a non-JSX file.
 */
export function getJsxDiagnostics(
  fileContent: string,
  uri: string,
): Diagnostic[] {
  // Only check TypeScript/JavaScript files
  if (!uri.match(/\.(tsx?|jsx?)$/)) {
    return [];
  }

  // Determine file type
  const isJsxFile = uri.match(/\.(tsx|jsx)$/);

  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    fileContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Find the first JSX node if it exists
  const firstJsxNode = findFirstJSXNode(sourceFile);
  if (!firstJsxNode) {
    return []; // No JSX elements found
  }

  // Get the position of the first JSX node
  const start = ts.getLineAndCharacterOfPosition(
    sourceFile,
    firstJsxNode.getStart(sourceFile),
  );
  const end = ts.getLineAndCharacterOfPosition(
    sourceFile,
    firstJsxNode.getEnd(),
  );

  const range = {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  };

  const hasPragma = hasJSXPragma(fileContent);
  const diagnostics: Diagnostic[] = [];

  if (isJsxFile) {
    // Case 1: .tsx or .jsx file missing pragma
    if (!hasPragma) {
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range,
        message: "To use JSX, you need to specify a @jsxImportSource",
        source: "vtlsp",
        code: "missing-jsx-pragma",
      };

      const codeActions: CodeAction[] = [
        { title: "Use React", pragma: "/** @jsxImportSource https://esm.sh/react@18.2.0 */\n" },
        { title: "Use Preact", pragma: "/** @jsxImportSource https://esm.sh/preact */\n" },
        { title: "Use Hono", pragma: "/** @jsxImportSource https://esm.sh/hono@latest/jsx */\n" },
      ]
        .map(option => ({
          title: option.title,
          kind: "quickfix",
          edit: {
            changes: {
              [uri]: [{
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: option.pragma,
              }],
            },
          },
        }));

      diagnostics.push(intoReflexiveDiagnostic(diagnostic, codeActions))
    }
  } else {
    // Case 2: .ts or .js file with JSX elements
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range,
      message: "This file contains JSX elements but is not a .tsx/.jsx file.",
      source: "vtlsp",
      code: "jsx-element-in-non-jsx-file",
    });
  }

  return diagnostics;
}

export function hasJSXElement(sourceFile: ts.SourceFile): boolean {
  let hasJsx = false;
  function visit(node: ts.Node) {
    if (hasJsx) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      hasJsx = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return hasJsx;
}

function hasJSXPragma(fileContent: string): boolean {
  return fileContent.includes("@jsxImportSource");
}

function findFirstJSXNode(
  sourceFile: ts.SourceFile,
): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let firstJsxNode: ts.JsxElement | ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node) {
    if (firstJsxNode) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      firstJsxNode = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return firstJsxNode;
}
