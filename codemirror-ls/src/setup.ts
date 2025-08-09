import { LSPlugin } from "./LSPlugin.js";
import type { LSClient } from "./LSClient.js";
import {
  getCompletionsExtensions,
  getRenameExtensions,
  getSignatureExtensions,
  getHoversExtensions,
  getContextMenuExtensions,
  getLintingExtensions,
  getReferencesExtensions,
  getWindowExtensions,
  type CompletionExtensionsArgs,
  type RenameExtensionsArgs,
  type HoverExtensionArgs,
  type DiagnosticArgs,
  type SignatureSuggestionArgs,
  type ReferenceExtensionsArgs,
  type WindowExtensionArgs,
} from "./extensions/index.js";
import type { ContextMenuArgs } from "./extensions/contextMenu.js";
import type { Extension } from "@codemirror/state";
import { asyncNoop } from "es-toolkit";

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

  const lsClient = options.client;

  const extensions: Extension[] = [
    LSPlugin.of({
      client: lsClient,
      documentUri: options.documentUri,
      languageId: options.languageId,
      sendDidOpen: options.sendDidOpen ?? true,
    }),
  ];

  if (!features.signatureHelp.disabled) {
    extensions.push(
      ...getSignatureExtensions({
        render: features.signatureHelp.render,
      }),
    );
  }

  if (!features.hovers.disabled) {
    extensions.push(
      getHoversExtensions({
        render: features.hovers.render,
        hoverTime: features.hovers.hoverTime,
      }),
    );
  }

  if (!features.completion?.disabled) {
    extensions.push(
      getCompletionsExtensions({
        render: features.completion.render,
        completionMatchBefore: features.completion?.completionMatchBefore,
      }),
    );
  }

  if (!features.references.disabled) {
    extensions.push(
      ...getReferencesExtensions({
        ...features.references,
        render: features.references.render,
      }),
    );
  }

  if (!features.renames.disabled) {
    extensions.push(
      ...getRenameExtensions({
        shortcuts: features.renames.shortcuts,
        ...features.renames,
      }),
    );
  }

  if (!features.contextMenu.disabled) {
    extensions.push(
      ...getContextMenuExtensions({
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
      ...getLintingExtensions({
        languageId: options.languageId,
        onExternalFileChange: features.linting.onExternalFileChange,
        render: options.features.linting?.render,
      }),
    );
  }

  if (!features.window.disabled) {
    extensions.push(
      ...getWindowExtensions({
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
  signatureHelp: FeatureOption<SignatureSuggestionArgs>;
  hovers: FeatureOption<HoverExtensionArgs>;
  references: FeatureOption<ReferenceExtensionsArgs>;
  completion: FeatureOption<CompletionExtensionsArgs>;
  renames: FeatureOption<RenameExtensionsArgs>;
  contextMenu: FeatureOption<
    Omit<ContextMenuArgs, "referencesArgs"> & {
      referencesArgs?: FeatureOption<ReferenceExtensionsArgs>;
    }
  >;
  linting: FeatureOption<DiagnosticArgs>;
  window: FeatureOption<WindowExtensionArgs>;
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
