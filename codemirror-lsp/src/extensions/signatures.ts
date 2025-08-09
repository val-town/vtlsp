// Largely from https://github.com/codemirror/lsp-client/blob/main/src/signature.ts

import type { EditorView, Tooltip, ViewUpdate } from "@codemirror/view";
import { ViewPlugin, showTooltip } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type * as LSP from "vscode-languageserver-protocol";
import { offsetToPos } from "../utils";
import type { LSExtensionGetter } from "./types";
import { LSCore } from "../LSPlugin";

export interface SignatureSuggestionArgs {
  render: RenderSignatureHelp;
}

export type RenderSignatureHelp = (
  element: HTMLElement,
  data: LSP.SignatureHelp,
  activeSignature: number,
  activeParameter?: number
) => Promise<void>;

export const getSignatureExtensions: LSExtensionGetter<
  SignatureSuggestionArgs
> = ({ render }) => {
  return [signatureState, createSignaturePlugin(render)];
};

function createSignaturePlugin(
  render: (
    element: HTMLElement,
    data: LSP.SignatureHelp,
    active: number
  ) => Promise<void>
) {
  return ViewPlugin.fromClass(
    class {
      activeRequest: { pos: number; drop: boolean } | null = null;
      delayedRequest: number = 0;

      update(update: ViewUpdate) {
        const lsPlugin = LSCore.ofOrThrow(update.view);
        const client = lsPlugin.client;

        if (this.activeRequest) {
          if (update.selectionSet) {
            this.activeRequest.drop = true;
            this.activeRequest = null;
          } else if (update.docChanged) {
            this.activeRequest.pos = update.changes.mapPos(
              this.activeRequest.pos
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
            (sigState && serverConf?.retriggerCharacters) || []
          );

          if (triggers) {
            update.changes.iterChanges(
              (_fromA, _toA, _fromB, _toB, inserted) => {
                let ins = inserted.toString();
                if (ins)
                  for (let ch of triggers) {
                    if (ins.indexOf(ch) > -1) triggerCharacter = ch;
                  }
              }
            );
          }
        }

        if (triggerCharacter) {
          this.startRequest(update.view, {
            triggerKind: 2 /* TriggerCharacter */,
            isRetrigger: !!sigState,
            triggerCharacter,
            activeSignatureHelp: sigState ? sigState.data : undefined,
          });
        } else if (sigState && update.selectionSet) {
          if (this.delayedRequest) clearTimeout(this.delayedRequest);
          this.delayedRequest = window.setTimeout(() => {
            this.startRequest(update.view, {
              triggerKind: 3 /* ContentChange */,
              isRetrigger: true,
              activeSignatureHelp: sigState.data,
            });
          }, 250);
        }
      }

      startRequest(view: EditorView, context: LSP.SignatureHelpContext) {
        const lsPlugin = LSCore.ofOrThrow(view);
        const documentUri = lsPlugin.documentUri;

        if (this.delayedRequest) clearTimeout(this.delayedRequest);
        let pos = view.state.selection.main.head;
        if (this.activeRequest) this.activeRequest.drop = true;
        let req = (this.activeRequest = { pos, drop: false });

        lsPlugin
          .requestWithLock("textDocument/signatureHelp", {
            context,
            position: offsetToPos(view.state.doc, pos),
            textDocument: { uri: documentUri },
          })
          .then(
            (result) => {
              // TODO: check type of result

              if (req.drop) return;
              if (result && result.signatures.length > 0) {
                let cur = view.state.field(signatureState);
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

                let same = cur && sameSignatures(cur.data, result);
                let activeSignature =
                  same && context.triggerKind === 3
                    ? cur.active
                    : (result.activeSignature ?? 0);
                let activeParameter =
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
            },
            context.triggerKind === 1 /* Invoked */
              ? (err) => console.error("Signature request failed", err)
              : undefined
          );
      }

      destroy() {
        if (this.delayedRequest) clearTimeout(this.delayedRequest);
        if (this.activeRequest) this.activeRequest.drop = true;
      }
    }
  );
}

function sameSignatures(a: LSP.SignatureHelp, b: LSP.SignatureHelp) {
  if (a.signatures.length !== b.signatures.length) return false;
  return a.signatures.every((s, i) => s.label === b.signatures[i].label);
}

function sameActiveParam(
  a: LSP.SignatureHelp,
  b: LSP.SignatureHelp,
  active: number
) {
  return (
    (a.signatures[active].activeParameter ?? a.activeParameter) ===
    (b.signatures[active].activeParameter ?? b.activeParameter)
  );
}

class SignatureState {
  constructor(
    readonly data: LSP.SignatureHelp,
    readonly active: number,
    readonly tooltip: Tooltip
  ) {}
}

const signatureState = StateField.define<SignatureState | null>({
  create() {
    return null;
  },
  update(sig, tr) {
    for (let e of tr.effects)
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
            })
          );
        } else {
          return null;
        }
      }
    if (sig && tr.docChanged)
      return new SignatureState(sig.data, sig.active, {
        ...sig.tooltip,
        pos: tr.changes.mapPos(sig.tooltip.pos),
      });
    return sig;
  },
  provide: (f) => showTooltip.from(f, (sig) => sig && sig.tooltip),
});

const signatureEffect = StateEffect.define<{
  data: LSP.SignatureHelp;
  activeSignature: number;
  activeParameter?: number;
  pos: number;
  render: RenderSignatureHelp;
} | null>();

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
      let dom = document.createElement("div");
      render(dom, data, activeSignature, activeParameter);
      return { dom };
    },
  };
}
