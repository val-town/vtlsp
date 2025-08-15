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
import {
  isInCurrentDocumentBounds,
  posToOffset,
  posToOffsetOrZero,
} from "../utils.js";
import type { LSExtensionGetter, Renderer } from "./types.js";

export interface DiagnosticArgs {
  onExternalFileChange?: (changes: LSP.WorkspaceEdit) => void;
  render?: LintingRenderer;
}

export type LintingRenderer = Renderer<
  [message: string | LSP.MarkupContent | LSP.MarkedString | LSP.MarkedString[]]
>;

export const getLintingExtensions: LSExtensionGetter<DiagnosticArgs> = ({
  onExternalFileChange,
  render,
}: DiagnosticArgs): Extension[] => {
  return [
    ViewPlugin.fromClass(
      class DiagnosticPlugin {
        #disposeHandler: (() => void) | null = null;
        private diagnosticDispatchQueue = new PQueue({ concurrency: 1 });

        constructor(private view: EditorView) {
          const lsPlugin = LSCore.ofOrThrow(view);

          this.#disposeHandler = lsPlugin.client.onNotification(
            async (method, params) => {
              if (method !== "textDocument/publishDiagnostics") return;

              this.processDiagnostics({
                params,
                view: this.view,
                onExternalFileChange,
                render,
              });
            },
          );
        }

        destroy() {
          if (this.#disposeHandler) {
            this.#disposeHandler();
            this.#disposeHandler = null;
          }
          this.diagnosticDispatchQueue.clear();
        }

        private async processDiagnostics({
          params,
          view,
          onExternalFileChange,
          render,
        }: {
          params: PublishDiagnosticsParams;
          view: EditorView;
          onExternalFileChange?: (changes: LSP.WorkspaceEdit) => void;
          render?: LintingRenderer;
        }) {
          const versionAtNotification = params.version;
          const lsPlugin = LSCore.ofOrThrow(view);

          if (params.uri !== lsPlugin.documentUri) return;

          // Clear any pending diagnostic dispatches to ensure latest diagnostics take priority
          this.diagnosticDispatchQueue.clear();

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

            const codemirrorActions = (
              await Promise.all(
                (Array.isArray(actions) ? actions : []).map(
                  async (action): Promise<Action | null> => {
                    return {
                      name:
                        "command" in action &&
                        typeof action.command === "object"
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

                          const hasExternalFileChanges =
                            resolvedAction.edit?.documentChanges?.some(
                              (change) =>
                                "textDocument" in change &&
                                change.textDocument.uri !==
                                  lsPlugin.documentUri,
                            );

                          if (hasExternalFileChanges) {
                            if (onExternalFileChange) {
                              onExternalFileChange(resolvedAction.edit);
                            } else {
                              showDialog(view, {
                                label: "External file changes not supported",
                              });
                            }
                            return;
                          } else {
                            const documentChanges =
                              resolvedAction.edit?.documentChanges || [];

                            const edits = documentChanges
                              .filter((change) => "edits" in change)
                              .flatMap((change) => change.edits || []);

                            for (const edit of edits) {
                              changes.push(edit as LSP.TextEdit);
                            }
                          }

                          if (changes.length === 0) return;

                          // Apply workspace edit
                          for (const change of changes) {
                            view.dispatch(
                              view.state.update({
                                changes: {
                                  from: posToOffsetOrZero(
                                    view.state.doc,
                                    change.range.start,
                                  ),
                                  to: posToOffset(
                                    view.state.doc,
                                    change.range.end,
                                  ),
                                  insert: change.newText,
                                },
                              }),
                            );
                          }
                        } else if (
                          "command" in resolvedAction &&
                          resolvedAction.command
                        ) {
                          // TODO: Implement command execution
                          showDialog(view, {
                            label: "Command execution not implemented yet",
                          });
                        }
                      },
                    };
                  },
                ),
              )
            ).filter(Boolean) as Action[];

            const processedDiagnostic: Diagnostic = {
              from: posToOffsetOrZero(view.state.doc, range.start),
              to: posToOffsetOrZero(view.state.doc, range.end),
              severity: severityMap[severity ?? LSP.DiagnosticSeverity.Error],
              message: message,
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

          // Enqueue the dispatch to ensure diagnostics are applied in order
          return this.diagnosticDispatchQueue.add(async () => {
            const resolvedDiagnostics = await Promise.all(diagnostics);

            // Check if document version still matches before applying
            if (versionAtNotification !== lsPlugin.documentVersion) {
              // Document has changed since the diagnostics were received; discard them
              return;
            }

            view.dispatch(setDiagnostics(view.state, resolvedDiagnostics));
          });
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
