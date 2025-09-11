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
import { ViewPlugin } from "@codemirror/view";
import type { PublishDiagnosticsParams } from "vscode-languageserver-protocol";
import * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { isInCurrentDocumentBounds, posToOffsetOrZero } from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface DiagnosticArgs {
  render?: LintingRenderer;
}

export type LintingRenderer = Renderer<
  [message: string | LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]]
>;

export const getLintingExtensions: LSExtensionGetter<DiagnosticArgs> = ({
  render,
}: DiagnosticArgs): Extension[] => {
  return [
    ViewPlugin.fromClass(
      class DiagnosticPlugin {
        constructor(private view: EditorView) {
          const lsPlugin = LSCore.ofOrThrow(view);

          void lsPlugin.client.onNotification(async (method, params) => {
            if (method !== "textDocument/publishDiagnostics") return;

            void this.processDiagnostics({
              params,
              view: this.view,
              render,
            });
          });
        }

        private async processDiagnostics({
          params,
          view,
          render,
        }: {
          params: PublishDiagnosticsParams;
          view: EditorView;
          render?: LintingRenderer;
        }) {
          const versionAtNotification = params.version;
          const lsPlugin = LSCore.ofOrThrow(view);

          if (params.uri !== lsPlugin.documentUri) return;

          const severityMap: Record<
            LSP.DiagnosticSeverity,
            Diagnostic["severity"]
          > = {
            [LSP.DiagnosticSeverity.Error]: "error",
            [LSP.DiagnosticSeverity.Warning]: "warning",
            [LSP.DiagnosticSeverity.Information]: "info",
            [LSP.DiagnosticSeverity.Hint]: "info",
          };

          // Process diagnostics concurrently
          const diagnostics = params.diagnostics.map(async (diagnostic) => {
            const { range, message, severity } = diagnostic;

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
                      lsPlugin._reportError(
                        "Command execution not implemented yet for LSP action commands.",
                      );
                    }
                  },
                };
              })
              .filter(Boolean) as Action[];

            const processedDiagnostic: Diagnostic = {
              from: posToOffsetOrZero(view.state.doc, range.start),
              to: posToOffsetOrZero(view.state.doc, range.end),
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
              actions: codemirrorActions,
            };

            return processedDiagnostic;
          });

          const resolvedDiagnostics = await Promise.all(diagnostics);

          // Check if document version still matches before applying
          if (versionAtNotification !== lsPlugin.documentVersion) {
            // Document has changed since the diagnostics were received; discard them
            return;
          }

          view.dispatch(setDiagnostics(view.state, resolvedDiagnostics));
        }

        private async requestCodeActions(diagnostic: LSP.Diagnostic): Promise<{
          actions: (LSP.Command | LSP.CodeAction)[] | null;
          resolveAction: (
            action: LSP.Command | LSP.CodeAction,
          ) => Promise<LSP.Command | LSP.CodeAction>;
        }> {
          const lsPlugin = LSCore.ofOrThrow(this.view);

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
