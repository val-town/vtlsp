import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { _getYouNeedNpmReactTypesDiagnostic, getYouShouldUseEsmShDiagnostic } from "./useEsmShInstead.ts";
import type { Diagnostic } from "vscode-languageserver-protocol";

describe("useEsmShInstead ", () => {
  it("determines that a diagnostic list contains the 'you need npm:react types' diagnostic", () => {
    const diagnostics = [
      {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
        severity: 1,
        code: 2875,
        source: "deno-ts",
        message: "This JSX tag requires the module path 'npm:react@18.2.0/jsx-runtime' to exist, but none could be found. Make sure you have types for the appropriate package installed."
      }
    ] satisfies Diagnostic[];

    const result = _getYouNeedNpmReactTypesDiagnostic(diagnostics);
    expect(result).not.toBe(null);
    expect(result?.message).toContain("npm:react");
  });

  it("determines that a diagnostic list does not contain the 'you need npm:react types' diagnostic", () => {
    const diagnostics = [
      {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
        severity: 2,
        code: 2873,
        source: "deno-ts",
        message: "Some other diagnostic message."
      }
    ] satisfies Diagnostic[];

    const result = _getYouNeedNpmReactTypesDiagnostic(diagnostics);
    expect(result).toBe(null);
  });

  it("determines that a diagnostic list contains the 'react must be in scope' diagnostic", () => {
    const diagnostics = [
      {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
        severity: 1,
        code: 2875,
        source: "deno-ts",
        message: "This JSX tag requires 'React' to be in scope, but it could not be found."
      }
    ] satisfies Diagnostic[];

    const result = _getYouNeedNpmReactTypesDiagnostic(diagnostics);
    expect(result).not.toBe(null);
    expect(result?.message).toContain("React' to be in scope");
  });

  it("properly provides the useEsmShInstead diagnostic", () => {
    const diagnostics = [
      {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
        severity: 1,
        code: 2875,
        source: "deno-ts",
        message: "This JSX tag requires the module path 'npm:react@18.2.0/jsx-runtime' to exist, but none could be found. Make sure you have types for the appropriate package installed."
      }
    ] satisfies Diagnostic[];

    const newDiagnostics = getYouShouldUseEsmShDiagnostic(diagnostics);
    expect(newDiagnostics).toEqual([{
      range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
      severity: 1,
      code: "should-use-esm-sh",
      source: "vtlsp",
      message: "Using react with an npm: specifier for react versions older than 19.0 is not advised since they do not include types. Try importing react using 'https://esm.sh/react' instead."
    }]);
  });
});
