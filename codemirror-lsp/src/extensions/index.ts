export {
  getCompletionsExtensions,
  toCodemirrorCompletion,
  toCodemirrorSnippet as convertSnippet,
  sortCompletionItems,
  type CompletionExtensionsArgs,
  type CompletionRenderer,
} from "./completions";

export {
  getRenameExtensions,
  handleRename,
  type RenameExtensionsArgs,
} from "./renames";

export {
  getSignatureExtensions,
  type RenderSignatureHelp,
  type SignatureSuggestionArgs,
} from "./signatures";

export {
  getHoversExtensions,
  type RenderHover,
  type HoverExtensionArgs,
} from "./hovers";

export {
  getContextMenuExtensions,
  handleContextMenu,
  contextMenuActivated as contextMenuActivateAnnotation,
  type ContextMenuRenderer,
  type ContextMenuCallbacks,
  type ContextMenuArgs,
} from "./contextMenu";

export {
  getLintingExtensions,
  type LintingRenderer,
  type DiagnosticArgs,
} from "./linting";

export {
  getReferencesExtensions,
  handleFindReferences,
  closeReferencePanel,
  type ReferenceExtensionsArgs,
} from "./references";

export {
  getWindowExtensions,
  type WindowExtensionArgs,
  type WindowRenderer,
} from "./window";

export type { Renderer } from "./types";
