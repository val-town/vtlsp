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
}: DiagnosticArgs): Extension[] => {
  return [
    ViewPlugin.fromClass(
      class DiagnosticPlugin {
        #disposeHandler: (() => void) | null = null;

        /**
         * Queue for processing diagnostics sequentially.
         *
         * We want to ensure that diagnostics are processed in the order they
         * are received, including post-processing associated code actions.
         *
         * If we receive many diagnostics at once in short succession, we
         * request code actions for each, and may receive responses in
         * non-deterministic order. This ensures that we process them in the
         * order they were originally received.
         */
        #dispatchQueue = new PQueue({ concurrency: 1 });
        #view: EditorView;

        constructor(private view: EditorView) {
          this.#view = view;
          const lsPlugin = LSCore.ofOrThrow(view);

          void lsPlugin.client.onNotification(async (method, params) => {
            if (method !== "textDocument/publishDiagnostics") return;

            this.#dispatchQueue.add(
              async () =>
                await this.processDiagnostics({
                  params,
                  view: this.view,
                }),
            );
          });
        }

        destroy() {
          if (this.#disposeHandler) {
            this.#disposeHandler();
            this.#disposeHandler = null;
          }
        }

        private async processDiagnostics({
          params,
          view,
        }: {
          params: PublishDiagnosticsParams;
          view: EditorView;
        }) {
          // TODO: This is very fancy logic. We really should find a way to test this!

          const versionAtNotification = params.version;
          const lsPlugin = LSCore.ofOrThrow(view);

          if (params.uri !== lsPlugin.documentUri) return;
          if (params.version !== lsPlugin.documentVersion) return;

          const diagnosticResults = params.diagnostics.map((diagnostic) =>
            this.lazyLoadCodemirrorDiagnostic(diagnostic),
          );

          const immediateDiagnostics = diagnosticResults.map(
            ([immediate]) => immediate,
          );

          if (versionAtNotification !== lsPlugin.documentVersion) return;
          view.dispatch(setDiagnostics(view.state, immediateDiagnostics));

          const resolvedDiagnostics = await Promise.all(
            diagnosticResults.map(([, promise]) => promise),
          );

          // It takes time for actions to process. Make sure doc is still same
          // version to avoid showing old diagnostics.

          if (versionAtNotification !== lsPlugin.documentVersion) return;

          // If **none** of the diagnostics changed, don't dispatch again.
          const allSame = resolvedDiagnostics.every(
            (diag, i) => diag === immediateDiagnostics[i],
          );
          if (allSame) return;

          view.dispatch(setDiagnostics(view.state, resolvedDiagnostics));
        }

        /**
         * Convert an LSP Diagnostic to a CodeMirror Diagnostic, with lazy-loaded actions.
         *
         * This function immediately returns a CodeMirror Diagnostic with basic
         * information (range, message, severity), and a Promise that resolves to
         * a full Diagnostic including actions once code actions have been fetched.
         *
         * If there are no actions, the immediate diagnostic is returned as the
         * same object identity as the original one (so you can avoid duplicate dispatches).
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
