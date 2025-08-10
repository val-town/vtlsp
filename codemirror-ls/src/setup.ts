import { LSPlugin } from "./LSPlugin.js";
import type { LSClient } from "./LSClient.js";
import type { Extension } from "@codemirror/state";
import { asyncNoop } from "es-toolkit";
import {
  signatures,
  completions,
  contextMenu,
  hovers,
  references,
  renames,
  linting,
  window,
} from "./extensions/index.js";

export function languageServerWithClient(options: LanguageServerOptions) {
  const features = {
    signatureHelp: { render: asyncNoop },
    hovers: { render: asyncNoop },
    references: { render: asyncNoop },
    completion: { render: asyncNoop },
    renames: { shortcuts: [{ key: "F2" }] },
    contextMenu: { render: asyncNoop },
    linting: {},
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
  });
  extensions.push(lsPlugin);

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
          render: features.references.render,
          ...features.contextMenu.referencesArgs,
        },
      }),
    );
  }

  if (!options.features.linting?.disabled) {
    extensions.push(
      ...linting.getLintingExtensions({
        languageId: options.languageId,
        onExternalFileChange: features.linting.onExternalFileChange,
        render: options.features.linting?.render,
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

type FeatureOption<T> = { disabled?: boolean } & Omit<
  T,
  "client" | "documentUri" | "languageId"
>;

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
  /** Whether to send incremental changes to the language server. */
  sendIncrementalChanges?: boolean;
}
