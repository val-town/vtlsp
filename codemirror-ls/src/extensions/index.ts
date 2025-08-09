export {
  getCompletionsExtensions,
  toCodemirrorCompletion,
  toCodemirrorSnippet as convertSnippet,
  sortCompletionItems,
  type CompletionExtensionsArgs,
  type CompletionRenderer,
} from "./completions.js";

export {
  getRenameExtensions,
  handleRename,
  type RenameExtensionsArgs,
} from "./renames.js";

export {
  getSignatureExtensions,
  type RenderSignatureHelp,
  type SignatureSuggestionArgs,
} from "./signatures.js";

export {
  getHoversExtensions,
  type RenderHover,
  type HoverExtensionArgs,
} from "./hovers.js";

export {
  getContextMenuExtensions,
  handleContextMenu,
  contextMenuActivated as contextMenuActivateAnnotation,
  type ContextMenuRenderer,
  type ContextMenuCallbacks,
  type ContextMenuArgs,
} from "./contextMenu.js";

export {
  getLintingExtensions,
  type LintingRenderer,
  type DiagnosticArgs,
} from "./linting.js";

export {
  getReferencesExtensions,
  handleFindReferences,
  closeReferencePanel,
  type ReferenceExtensionsArgs,
} from "./references.js";

export {
  getWindowExtensions,
  type WindowExtensionArgs,
  type WindowRenderer,
} from "./window.js";

export type { Renderer } from "./types.js";
