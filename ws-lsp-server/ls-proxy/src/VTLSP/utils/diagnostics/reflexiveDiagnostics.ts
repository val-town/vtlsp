import type { CodeAction, Diagnostic } from "vscode-languageserver-protocol";
import { logger } from "../../../logger.ts";

/**
 * Convert a diagnostic + code action into a "reflexive" diagnostic that embeds
 * the code action in the diagnostic's data.
 */
export function intoReflexiveDiagnostic(diagnostic: Diagnostic, codeActions: CodeAction[]): Diagnostic {
  return {
    ...diagnostic,
    code: "reflexive-diagnostic",
    data: { action: codeActions },
  };
}

/**
 * Extracts code actions from reflexive diagnostics.
 *
 * This function looks for diagnostics that have been transformed into reflexive
 * diagnostics, which contain embedded code actions in their data.
 *
 * @param diagnostics The array of diagnostics to extract code actions from
 * @returns An array of extracted code actions
 */
export function extractReflexiveDiagnostics(diagnostics: Diagnostic[]): CodeAction[] {
  const extractedActions: CodeAction[] = [];
  logger.debug(
    { diagnostics: diagnostics},
    "Extracting reflexive diagnostics from code actions",
  );

  for (const diagnostic of diagnostics) {
    // Check if it's a reflexive diagnostic with embedded actions
    if (typeof diagnostic === "object" && diagnostic !== null &&
      diagnostic.code === "reflexive-diagnostic" &&
      typeof diagnostic.data === "object" &&
      diagnostic.data !== null &&
      "action" in diagnostic.data) {
      extractedActions.push(...diagnostic.data.action as CodeAction[]);
    }
  }

  return extractedActions;
}