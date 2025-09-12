/**
 * @module linting
 * @description Extensions for handling diagnostics and code actions in the editor.
 *
 * "Linting" here refers to all diagnostics and associated code actions. These
 * are the buttons that show up on top of squiggly lines like "infer return
 * type."
 *
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_publishDiagnostics
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_codeAction
 */

import { type Action, type Diagnostic, setDiagnostics } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { showDialog, ViewPlugin } from "@codemirror/view";
import PQueue from "p-queue";
import type { PublishDiagnosticsParams } from "vscode-languageserver-protocol";
import * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { isInCurrentDocumentBounds, posToOffsetOrZero } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface DiagnosticArgs {
  render?: LintingRenderer;
  /**
   * Mapping from LSP DiagnosticSeverity to CodeMirror Diagnostic severity.
   *
   * Generally you shouldn't need to change this.
   */
  severityMap?: typeof SEVERITY_MAP;
  /**
   * If false, disables requesting and attaching code actions to diagnostics.
   */
  enableCodeActions?: boolean;
}

export type LintingRenderer = Renderer<
  [message: string | LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]]
>;

export const SEVERITY_MAP: Record<
  LSP.DiagnosticSeverity,
  Diagnostic["severity"]
> = {
  [LSP.DiagnosticSeverity.Error]: "error",
  [LSP.DiagnosticSeverity.Warning]: "warning",
  [LSP.DiagnosticSeverity.Information]: "info",
  [LSP.DiagnosticSeverity.Hint]: "info",
};

export const getLintingExtensions: LSExtensionGetter<DiagnosticArgs> = ({
  render,
  severityMap = SEVERITY_MAP,
  enableCodeActions = true,
}: DiagnosticArgs): Extension[] => {
  return [
    ViewPlugin.fromClass(
      class DiagnosticPlugin {
        #view: EditorView;
        #codeActionQueryAbortController = new AbortController();

        constructor(private view: EditorView) {
          this.#view = view;
          const lsPlugin = LSCore.ofOrThrow(view);

          void lsPlugin.client.onNotification(async (method, params) => {
            if (method !== "textDocument/publishDiagnostics") return;

            await this.processDiagnostics({
              params,
              view: this.view,
            });
          });
        }

        private async processDiagnostics({
          params,
          view,
        }: {
          params: PublishDiagnosticsParams;
          view: EditorView;
        }) {
          // Every time this method is called (when the LSP sends us new diagnostics) we:
          // - abort any in-progress code action queries since they will no longer be relevant
          // - create a new abort controller for our new code action queries
          // - update the editor diagnostics right away
          // - if we receive the code action response and the document version is still the same,
          //   and the abort controller hasn't been aborted, update the diagnostics again
          //
          // Note that the language server may send many diagnostics for the
          // same document version and it is critical that we respect the **LAST** one.
          this.#codeActionQueryAbortController.abort();
          const newCodeActionQueryAbortController = new AbortController();
          this.#codeActionQueryAbortController = newCodeActionQueryAbortController;

          const versionAtNotification = params.version;
          const lsPlugin = LSCore.ofOrThrow(view);

          if (params.uri !== lsPlugin.documentUri) return;
          if (params.version !== lsPlugin.documentVersion) return;

          const diagnosticResults = params.diagnostics.map((diagnostic) =>
            this.lazyLoadCodemirrorDiagnostic(diagnostic),
          );

          const diagnosticsWithoutActions = diagnosticResults.map(
            ([immediate]) => immediate,
          );

          if (versionAtNotification !== lsPlugin.documentVersion) return;
          view.dispatch(setDiagnostics(view.state, diagnosticsWithoutActions));

          // Queue code actions resolution for each diagnostic
          const diagnosticsWithActions = await Promise.all(
            diagnosticResults.map(([, promise]) => promise)
          );

          if (versionAtNotification !== lsPlugin.documentVersion) return;

          const allSame = diagnosticsWithActions.every((diag, i) =>
            Object.is(diag, diagnosticsWithoutActions[i]),
          );
          if (allSame) return;

          if (newCodeActionQueryAbortController.signal.aborted) return;

          view.dispatch(setDiagnostics(view.state, diagnosticsWithActions));
        }

        /**
         * Convert an LSP Diagnostic to a CodeMirror Diagnostic, with lazy-loaded actions.
         *
         * This function immediately returns a CodeMirror Diagnostic with basic
         * information (range, message, severity), and a Promise that resolves
         * to a full Diagnostic including actions once code actions have been
         * fetched.
         *
         * If there are no actions, the lazy diagnostic is returned as the same
         * object identity as the original one (so you can avoid duplicate
         * dispatches by checking for equality).
         */
        private lazyLoadCodemirrorDiagnostic(
          diagnostic: LSP.Diagnostic,
        ): [Diagnostic, Promise<Diagnostic>] {
          const lsPlugin = LSCore.ofOrThrow(this.#view);

          const { range, message, severity } = diagnostic;

          const currentDiagnostic: Diagnostic = {
            from: posToOffsetOrZero(this.#view.state.doc, range.start),
            to: posToOffsetOrZero(this.#view.state.doc, range.end),
            severity: severityMap[severity ?? LSP.DiagnosticSeverity.Error],
            message,
            renderMessage: render
              ? () => {
                const dom = document.createElement("div");
                render(dom, message);
                return dom;
              }
              : undefined,
            source: diagnostic.source,
            actions: [], // for now
          };

          // If code actions are disabled, just return the diagnostic as-is.
          if (!enableCodeActions) {
            return [currentDiagnostic, Promise.resolve(currentDiagnostic)];
          }

          const diagnosticWithActions: Promise<Diagnostic> = (async () => {
            const { actions, resolveAction } =
              await this.requestCodeActions(diagnostic);

            const codemirrorActions = (Array.isArray(actions) ? actions : [])
              .map((action): Action | null => {
                return {
                  name:
                    "command" in action && typeof action.command === "object"
                      ? action.command?.title || action.title
                      : action.title,
                  apply: async () => {
                    const resolvedAction = await resolveAction(action);

                    if (
                      "edit" in resolvedAction &&
                      (resolvedAction.edit?.changes ||
                        resolvedAction.edit?.documentChanges)
                    ) {
                      const changes: LSP.TextEdit[] = [];

                      if (resolvedAction.edit?.changes) {
                        for (const change of resolvedAction.edit.changes[
                          lsPlugin.documentUri
                        ] || []) {
                          changes.push(change);
                        }
                      }

                      void lsPlugin.applyWorkspaceEdit(resolvedAction.edit);
                    } else if (
                      "command" in resolvedAction &&
                      resolvedAction.command
                    ) {
                      // TODO: Implement command execution
                      showDialog(this.#view, {
                        label: "Command execution not implemented yet",
                      });
                    }
                  },
                };
              })
              .filter(Boolean) as Action[];

            if (codemirrorActions.length === 0) return currentDiagnostic;

            // (see doc): make sure this is a **new** object instance for comparison purposes
            return {
              ...currentDiagnostic,
              actions: codemirrorActions,
            };
          })();

          return [currentDiagnostic, diagnosticWithActions];
        }

        private async requestCodeActions(diagnostic: LSP.Diagnostic): Promise<{
          actions: (LSP.Command | LSP.CodeAction)[] | null;
          resolveAction: (
            action: LSP.Command | LSP.CodeAction,
          ) => Promise<LSP.Command | LSP.CodeAction>;
        }> {
          const lsPlugin = LSCore.ofOrThrow(this.#view);

          if (!lsPlugin.client.capabilities?.codeActionProvider) {
            return {
              actions: null,
              resolveAction: async (action) => action,
            };
          }

          // The doc could have changed since the diagnostic was received
          if (!isInCurrentDocumentBounds(diagnostic.range, this.view))
            return {
              actions: null,
              resolveAction: async (action) => action,
            };

          const actions = await lsPlugin.requestWithLock(
            "textDocument/codeAction",
            {
              textDocument: { uri: lsPlugin.documentUri },
              range: diagnostic.range,
              context: {
                diagnostics: [diagnostic],
              },
            },
          );

          const resolveAction = async (
            action: LSP.Command | LSP.CodeAction,
          ): Promise<LSP.Command | LSP.CodeAction> => {
            // If action has 'data' property and the server supports resolving,
            // resolve the action
            if (
              "data" in action &&
              lsPlugin.client.capabilities?.codeActionProvider &&
              typeof lsPlugin.client.capabilities.codeActionProvider !==
              "boolean" &&
              lsPlugin.client.capabilities.codeActionProvider.resolveProvider
            ) {
              return (await lsPlugin.requestWithLock(
                "codeAction/resolve",
                action satisfies LSP.CodeAction,
              )) as LSP.CodeAction;
            }

            // Otherwise, return the action as-is
            return action;
          };

          return {
            actions,
            resolveAction,
          };
        }
      },
    ),
  ];
};
