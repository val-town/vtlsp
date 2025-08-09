import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { expect } from "https://deno.land/x/expect@v0.4.0/mod.ts";
import type { CodeAction, Diagnostic } from "vscode-languageserver-protocol";
import { intoReflexiveDiagnostic, extractReflexiveDiagnostics } from "./reflexiveDiagnostics.ts";

describe("reflexiveDiagnostics", () => {
  describe("intoReflexiveDiagnostic", () => {
    it("converts diagnostic with code actions", () => {
      const diagnostic: Diagnostic = {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 }
        },
        message: "Test diagnostic",
        severity: 1
      };

      const codeActions: CodeAction[] = [
        {
          title: "Fix issue",
          kind: "quickfix"
        }
      ];

      const result = intoReflexiveDiagnostic(diagnostic, codeActions);

      expect(result.code).toEqual("reflexive-diagnostic");
      expect(result.data).toEqual({ action: codeActions });
      expect(result.message).toEqual("Test diagnostic");
      expect(result.range).toEqual(diagnostic.range);
    });
  });

  describe("extractReflexiveDiagnostics", () => {
    it("extracts code actions from reflexive diagnostics", () => {
      const codeActions: CodeAction[] = [
        { title: "Fix 1", kind: "quickfix" },
        { title: "Fix 2", kind: "refactor" }
      ];

      const reflexiveDiagnostic: Diagnostic = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        message: "Test",
        code: "reflexive-diagnostic",
        data: { action: codeActions }
      };

      const normalDiagnostic: Diagnostic = {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
        message: "Normal diagnostic"
      };

      const diagnostics = [reflexiveDiagnostic, normalDiagnostic];
      const extractedCodeActions = extractReflexiveDiagnostics(diagnostics);

      expect(extractedCodeActions.length).toEqual(2);
      expect(extractedCodeActions).toEqual(codeActions);
    });

    it("handles empty array", () => {
      const result = extractReflexiveDiagnostics([]);
      expect(result).toEqual([]);
    });

    it("handles non-reflexive diagnostics", () => {
      const diagnostics: Diagnostic[] = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          message: "Normal diagnostic"
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
          message: "Another normal diagnostic",
          code: "some-other-code"
        }
      ];

      const result = extractReflexiveDiagnostics(diagnostics);
      expect(result).toEqual([]);
    });
  });
});
