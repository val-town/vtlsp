import { type Extension, Prec } from "@codemirror/state";
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

async function asyncNoop(): Promise<void> {}

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
    signatureHelp: {
      disabled: false,
      render: asyncNoop,
      ...options.features.signatureHelp,
    },
    hovers: { disabled: false, render: asyncNoop, ...options.features.hovers },
    references: {
      disabled: false,
      render: asyncNoop,
      ...options.features.references,
    },
    completion: {
      disabled: false,
      render: asyncNoop,
      ...options.features.completion,
    },
    renames: {
      disabled: false,
      shortcuts: [{ key: "F2" }],
      render: asyncNoop,
      ...options.features.renames,
    },
    contextMenu: {
      disabled: false,
      referencesArgs: {},
      render: asyncNoop,
      ...options.features.contextMenu,
      disableRename: options.features.renames?.disabled ?? false,
    },
    linting: {
      disabled: false,
      render: asyncNoop,
      ...options.features.linting,
    },
    window: { disabled: false, render: asyncNoop, ...options.features.window },
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
      ...signatures.getSignatureExtensions(features.signatureHelp),
    );
  }

  if (!features.hovers.disabled) {
    extensions.push(hovers.getHoversExtensions(features.hovers));
  }

  if (!features.completion?.disabled) {
    extensions.push(completions.getCompletionsExtensions(features.completion));
  }

  if (!features.references.disabled) {
    extensions.push(...references.getReferencesExtensions(features.references));
  }

  if (!features.renames.disabled) {
    extensions.push(...renames.getRenameExtensions(features.renames));
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
    extensions.push(...linting.getLintingExtensions(features.linting));
  }

  if (!features.window.disabled) {
    extensions.push(...window.getWindowExtensions(features.window));
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
