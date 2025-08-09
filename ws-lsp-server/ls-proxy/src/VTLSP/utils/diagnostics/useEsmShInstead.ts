import type { Diagnostic } from "vscode-languageserver-protocol";

/**
 * Checks if the diagnostics contain a message indicating that the npm:react types are needed.
 *
 * @param denoDiagnostics The list of diagnostics to check.
 * @returns Whether the diagnostic list contains the 'you need npm:react types' diagnostic.
 */
export function getYouShouldUseEsmShDiagnostic(denoDiagnostics: Diagnostic[]): Diagnostic[] {
  const diagnostic = _getYouNeedNpmReactTypesDiagnostic(denoDiagnostics);
  if (diagnostic) {
    return [{
      range: diagnostic.range,
      severity: 1,
      code: "should-use-esm-sh",
      source: "vtlsp",
      message: "Using react with an npm: specifier for react versions older than 19.0 is not advised since they do not include types. " +
        "Try importing react using 'https://esm.sh/react' instead."
    }];
  }

  return [];
}

const youNeedNpmReactTypes = /^This JSX tag requires the module path 'npm:(react)[^']*' to exist, but none could be found\./
const reactMustBeInScope = /This JSX tag requires 'React' to be in scope, but it could not be found./

export function _getYouNeedNpmReactTypesDiagnostic(denoDiagnostics: Diagnostic[]): Diagnostic | null {
  return denoDiagnostics.find(diagnostic =>
    youNeedNpmReactTypes.test(diagnostic.message) ||
    reactMustBeInScope.test(diagnostic.message)
  ) || null;
}
