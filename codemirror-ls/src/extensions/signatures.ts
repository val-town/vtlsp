/**
 * @module signatures
 * @description Extensions for handling signature help in the editor.
 * @author Modification of code from Marijnh's codemirror-lsp-client
 *
 * Signature help provides information about the parameters of a function
 * or method call, including their names, types, and documentation.
 *
 * @see https://github.com/codemirror/lsp-client/blob/main/src/signature.ts
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView, Tooltip, ViewUpdate } from "@codemirror/view";
import { showTooltip, ViewPlugin } from "@codemirror/view";
import * as LSP from "vscode-languageserver-protocol";
import { LSCore } from "../LSPlugin.js";
import { offsetToPos } from "../utils.js";
import type { LSExtensionGetter } from "./types.js";

/**
 * Renderer for the signature help popup that shows up above a function when you
 * are typing out an invocation.
 */
export interface SignatureSuggestionArgs {
  render: RenderSignatureHelp;
  /**
   * Sometimes signature help lags a bit while the LSP is processing updates.
   * This is the number of times to retry getting signature help.
   */
  maxAttempts?: number;
}

export type RenderSignatureHelp = (
  element: HTMLElement,
  data: LSP.SignatureHelp,
  /** The currently active signature in the signature help popup. Often there are just one signatures and this is 0. */
  activeSignature: number,
  /** The currently active function/method parameter in the signature help popup. */
  activeParameter?: number,
) => Promise<void>;

export const getSignatureExtensions: LSExtensionGetter<
  SignatureSuggestionArgs
> = ({ render, maxAttempts }) => {
  return [signatureState, createSignaturePlugin(render, maxAttempts)];
};

function createSignaturePlugin(
  render: (
    element: HTMLElement,
    data: LSP.SignatureHelp,
    active: number,
  ) => Promise<void>,
  maxAttempts = 3,
) {
  return ViewPlugin.fromClass(
    class {
      activeRequest: { pos: number; drop: boolean } | null = null;
      delayedRequest = 0;

      update(update: ViewUpdate) {
        const lsPlugin = LSCore.ofOrThrow(update.view);
        const client = lsPlugin.client;

        if (!client.capabilities?.signatureHelpProvider) return;

        if (this.activeRequest) {
          if (update.selectionSet) {
            this.activeRequest.drop = true;
            this.activeRequest = null;
          } else if (update.docChanged) {
            this.activeRequest.pos = update.changes.mapPos(
              this.activeRequest.pos,
            );
          }
        }

        const sigState = update.view.state.field(signatureState);
        let triggerCharacter = "";

        if (
          update.docChanged &&
          update.transactions.some((tr) => tr.isUserEvent("input.type"))
        ) {
          const serverConf = client.capabilities?.signatureHelpProvider;
          const triggers = (serverConf?.triggerCharacters || []).concat(
            (sigState && serverConf?.retriggerCharacters) || [],
          );
          if (triggers) {
            update.changes.iterChanges(
              (_fromA, _toA, _fromB, _toB, inserted) => {
                const ins = inserted.toString();
                if (ins)
                  for (const ch of triggers) {
                    if (ins.indexOf(ch) > -1) triggerCharacter = ch;
                  }
              },
            );
          }
        }

        if (triggerCharacter) {
          void this.startRequest(update.view, {
            triggerKind: LSP.SignatureHelpTriggerKind.TriggerCharacter,
            isRetrigger: !!sigState,
            triggerCharacter,
            activeSignatureHelp: sigState ? sigState.data : undefined,
          });
        } else if (sigState && update.selectionSet) {
          if (this.delayedRequest) clearTimeout(this.delayedRequest);
          this.delayedRequest = window.setTimeout(() => {
            void this.startRequest(update.view, {
              triggerKind: LSP.SignatureHelpTriggerKind.ContentChange,
              isRetrigger: true,
              activeSignatureHelp: sigState.data,
            });
          }, 250);
        }
      }

      async startRequest(view: EditorView, context: LSP.SignatureHelpContext) {
        const lsPlugin = LSCore.ofOrThrow(view);
        const documentUri = lsPlugin.documentUri;

        if (this.delayedRequest) clearTimeout(this.delayedRequest);
        const pos = view.state.selection.main.head;
        if (this.activeRequest) this.activeRequest.drop = true;
        this.activeRequest = { pos, drop: false };
        const req = this.activeRequest;

        try {
          let result = null;
          let attempts = 0;
          await new Promise((r) => setTimeout(r, 150));
          while (attempts < maxAttempts && !result) {
            result = await lsPlugin.requestWithLock(
              "textDocument/signatureHelp",
              {
                context,
                position: offsetToPos(view.state.doc, pos),
                textDocument: { uri: documentUri },
              },
            );
            attempts++;
          }

          if (req.drop) return;
          if (result && result.signatures.length > 0) {
            const cur = view.state.field(signatureState);
            if (!cur) {
              view.dispatch({
                effects: signatureEffect.of({
                  data: result,
                  activeSignature: result.activeSignature ?? 0,
                  activeParameter: result.activeParameter ?? 0,
                  pos: req.pos,
                  render,
                }),
              });
              return;
            }

            const same = cur && sameSignatures(cur.data, result);
            const activeSignature =
              same && context.triggerKind === 3
                ? cur.active
                : (result.activeSignature ?? 0);
            const activeParameter =
              result.signatures[activeSignature]?.activeParameter ??
              result.activeParameter ??
              0;

            // Don't update at all if nothing changed
            if (same && sameActiveParam(cur.data, result, activeSignature))
              return;

            view.dispatch({
              effects: signatureEffect.of({
                data: result,
                activeSignature: activeSignature,
                activeParameter,
                pos: same ? cur.tooltip.pos : req.pos,
                render,
              }),
            });
          } else if (view.state.field(signatureState)) {
            view.dispatch({ effects: signatureEffect.of(null) });
          }
        } catch (err) {
          if (context.triggerKind === 1 /* Invoked */) {
            throw new Error(err instanceof Error ? err.message : String(err));
          }
        }
      }

      destroy() {
        if (this.delayedRequest) clearTimeout(this.delayedRequest);
        if (this.activeRequest) this.activeRequest.drop = true;
      }
    },
  );
}

function sameSignatures(a: LSP.SignatureHelp, b: LSP.SignatureHelp) {
  if (a.signatures.length !== b.signatures.length) return false;
  return a.signatures.every((s, i) => s.label === b.signatures[i]?.label);
}

function sameActiveParam(
  a: LSP.SignatureHelp,
  b: LSP.SignatureHelp,
  active: number,
) {
  return (
    (a.signatures[active]?.activeParameter ?? a.activeParameter) ===
    (b.signatures[active]?.activeParameter ?? b.activeParameter)
  );
}

class SignatureState {
  constructor(
    readonly data: LSP.SignatureHelp,
    readonly active: number,
    readonly tooltip: Tooltip,
  ) {}
}

const signatureState = StateField.define<SignatureState | null>({
  create() {
    return null;
  },
  update(sig, tr) {
    for (const e of tr.effects)
      if (e.is(signatureEffect)) {
        if (e.value) {
          return new SignatureState(
            e.value.data,
            e.value.activeSignature,
            signatureTooltip({
              data: e.value.data,
              activeSignature: e.value.activeSignature,
              activeParameter: e.value.activeParameter,
              pos: e.value.pos,
              render: e.value.render,
            }),
          );
        }
        return null;
      }
    if (sig && tr.docChanged)
      return new SignatureState(sig.data, sig.active, {
        ...sig.tooltip,
        pos: tr.changes.mapPos(sig.tooltip.pos),
      });
    return sig;
  },
  provide: (f) => showTooltip.from(f, (sig) => sig?.tooltip ?? null),
});

const signatureEffect = StateEffect.define<{
  data: LSP.SignatureHelp;
  activeSignature: number;
  activeParameter?: number;
  pos: number;
  render: RenderSignatureHelp;
} | null>();

/** Display the signature tooltip for a specific position */
function signatureTooltip({
  data,
  activeSignature,
  activeParameter,
  pos,
  render,
}: {
  data: LSP.SignatureHelp;
  activeSignature: number;
  activeParameter?: number;
  pos: number;
  render: RenderSignatureHelp;
}): Tooltip {
  return {
    pos,
    above: true,
    clip: false,
    strictSide: true,
    create: (_view) => {
      const dom = document.createElement("div");
      dom.classList.add("cm-lsp-signature-tooltip");
      render(dom, data, activeSignature, activeParameter);
      return { dom };
    },
  };
}
