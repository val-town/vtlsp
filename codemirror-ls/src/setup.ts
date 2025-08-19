import { type Extension, Prec } from "@codemirror/state";
import { asyncNoop } from "es-toolkit";
import {
  completions,
  contextMenu,
  hovers,
  linting,
  references,
  renames,
  signatures,
  window,
} from "./extensions/index.js";
import type { LSClient } from "./LSClient.js";
import { LSPlugin } from "./LSPlugin.js";

/**
 * Utility function to set up a CodeMirror extension array that includes
 * everything needed to connect to a language server via the provided client.
 *
 * Gets extensions for all supported features, unless explicitly disabled, and
 * uses all provided configs.
 *
 * @example
 * ```ts
 * const lspExtensions = languageServerWithClient({
 *   client: lsClient,
 *   documentUri: `file://${path}`,
 *   languageId: "typescript",
 *   sendIncrementalChanges: false,
 *   sendDidOpen: true,
 *   features: {
 *     signatureHelp: {
 *       render: async (dom, data, activeSignature, activeParameter) => {
 *         const root = ReactDOM.createRoot(dom);
 *         root.render(
 *           <LSSignatureHelp
 *             data={data}
 *             activeParameter={activeParameter}
 *             activeSignature={activeSignature}
 *           />,
 *         );
 *       },
 *     },
 *     linting: {
 *       disable: true,
 *     },
 *     references: {
 *       render: async (dom, references, goToReference, onClose, kind) => {
 *         const root = ReactDOM.createRoot(dom);
 *         root.render(
 *           <LSGoTo
 *             onClose={onClose}
 *             locations={references}
 *             goTo={goToReference}
 *             kind={kind}
 *           />,
 *         );
 *       },
 *       modClickForDefinition: true,
 *       onExternalReference: (uri) => {
 *         console.log("Go to external reference", uri);
 *       },
 *       goToDefinitionShortcuts: ["F12"],
 *       modClickForDefinition: true,
 *     },
 *   },
 * });
 * ```
 */
export function languageServerWithClient(options: LanguageServerOptions) {
  const features = {
    signatureHelp: { render: asyncNoop },
    hovers: { render: asyncNoop },
    references: { render: asyncNoop },
    completion: { render: asyncNoop },
    renames: { shortcuts: [{ key: "F2" }] },
    contextMenu: { render: asyncNoop },
    linting: { render: asyncNoop },
    window: { render: asyncNoop },
    ...options.features,
  } satisfies LanguageServerFeatures;
  const extensions: Extension[] = [];

  const lsClient = options.client;

  const lsPlugin = LSPlugin.of({
    client: lsClient,
    documentUri: options.documentUri,
    languageId: options.languageId,
    sendDidOpen: options.sendDidOpen ?? true,
    sendCloseOnDestroy: options.sendCloseOnDestroy ?? true,
  });
  extensions.push(Prec.highest(lsPlugin));

  if (!features.signatureHelp.disabled) {
    extensions.push(
      ...signatures.getSignatureExtensions({
        render: features.signatureHelp.render,
      }),
    );
  }

  if (!features.hovers.disabled) {
    extensions.push(
      hovers.getHoversExtensions({
        render: features.hovers.render,
        hoverTime: features.hovers.hoverTime,
      }),
    );
  }

  if (!features.completion?.disabled) {
    extensions.push(
      completions.getCompletionsExtensions({
        render: features.completion.render,
        completionMatchBefore: features.completion?.completionMatchBefore,
      }),
    );
  }

  if (!features.references.disabled) {
    extensions.push(
      ...references.getReferencesExtensions({
        ...features.references,
        render: features.references.render,
      }),
    );
  }

  if (!features.renames.disabled) {
    extensions.push(
      ...renames.getRenameExtensions({
        shortcuts: features.renames.shortcuts,
        ...features.renames,
      }),
    );
  }

  if (!features.contextMenu.disabled) {
    extensions.push(
      ...contextMenu.getContextMenuExtensions({
        render: features.contextMenu.render,
        referencesArgs: {
          render: !features.references.disabled
            ? features.references?.render
            : asyncNoop,
          ...features.contextMenu.referencesArgs,
        },
      }),
    );
  }

  if (!features.linting.disabled) {
    extensions.push(
      ...linting.getLintingExtensions({
        onExternalFileChange: features.linting.onExternalFileChange,
        render: features.linting.render,
      }),
    );
  }

  if (!features.window.disabled) {
    extensions.push(
      ...window.getWindowExtensions({
        render: features.window.render,
      }),
    );
  }

  return extensions;
}

type FeatureOption<T> = ({ disabled?: boolean } & T) | { disabled: true };

export interface LanguageServerFeatures {
  signatureHelp: FeatureOption<signatures.SignatureSuggestionArgs>;
  hovers: FeatureOption<hovers.HoverExtensionArgs>;
  references: FeatureOption<references.ReferenceExtensionsArgs>;
  completion: FeatureOption<completions.CompletionExtensionsArgs>;
  renames: FeatureOption<renames.RenameExtensionsArgs>;
  contextMenu: FeatureOption<
    Omit<contextMenu.ContextMenuArgs, "referencesArgs"> & {
      referencesArgs?: FeatureOption<references.ReferenceExtensionsArgs>;
    }
  >;
  linting: FeatureOption<linting.DiagnosticArgs>;
  window: FeatureOption<window.WindowExtensionArgs>;
}

/**
 * Complete options for configuring the language server integration
 */
export interface LanguageServerOptions {
  /** Language server features, including which extensions to enable or disable */
  features: Partial<LanguageServerFeatures>;
  /** Pre-configured language server client instance */
  client: LSClient;
  /** URI of the current document being edited. */
  documentUri: string;
  /** Language identifier (e.g., 'typescript', 'javascript', etc.). */
  languageId: string;
  /** Whether to send the didOpen notification when the editor is initialized */
  sendDidOpen?: boolean;
  /** Whether to send the didClose notification when the editor is destroyed */
  sendCloseOnDestroy?: boolean;
}
