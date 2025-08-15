// Generated file, do not edit

/** biome-ignore-all lint/suspicious/noExplicitAny: generated */
import type * as LSP from "vscode-languageserver-protocol";

export interface LSPRequestMap {
  "textDocument/implementation": [
    LSP.ImplementationParams,
    LSP.Definition | LSP.DefinitionLink[] | null | null,
  ];
  "textDocument/typeDefinition": [
    LSP.TypeDefinitionParams,
    LSP.Definition | LSP.DefinitionLink[] | null | null,
  ];
  "workspace/workspaceFolders": [any, LSP.WorkspaceFolder[] | null | null];
  "workspace/configuration": [LSP.ConfigurationParams, LSP.LSPAny[] | null];
  "textDocument/documentColor": [
    LSP.DocumentColorParams,
    LSP.ColorInformation[] | null,
  ];
  "textDocument/colorPresentation": [
    LSP.ColorPresentationParams,
    LSP.ColorPresentation[] | null,
  ];
  "textDocument/foldingRange": [
    LSP.FoldingRangeParams,
    LSP.FoldingRange[] | null | null,
  ];
  "workspace/foldingRange/refresh": [any, null | null];
  "textDocument/declaration": [
    LSP.DeclarationParams,
    LSP.Declaration | LSP.DeclarationLink[] | null | null,
  ];
  "textDocument/selectionRange": [
    LSP.SelectionRangeParams,
    LSP.SelectionRange[] | null | null,
  ];
  "window/workDoneProgress/create": [
    LSP.WorkDoneProgressCreateParams,
    null | null,
  ];
  "textDocument/prepareCallHierarchy": [
    LSP.CallHierarchyPrepareParams,
    LSP.CallHierarchyItem[] | null | null,
  ];
  "callHierarchy/incomingCalls": [
    LSP.CallHierarchyIncomingCallsParams,
    LSP.CallHierarchyIncomingCall[] | null | null,
  ];
  "callHierarchy/outgoingCalls": [
    LSP.CallHierarchyOutgoingCallsParams,
    LSP.CallHierarchyOutgoingCall[] | null | null,
  ];
  "textDocument/semanticTokens/full": [
    LSP.SemanticTokensParams,
    LSP.SemanticTokens | null | null,
  ];
  "textDocument/semanticTokens/full/delta": [
    LSP.SemanticTokensDeltaParams,
    LSP.SemanticTokens | LSP.SemanticTokensDelta | null | null,
  ];
  "textDocument/semanticTokens/range": [
    LSP.SemanticTokensRangeParams,
    LSP.SemanticTokens | null | null,
  ];
  "workspace/semanticTokens/refresh": [any, null | null];
  "window/showDocument": [
    LSP.ShowDocumentParams,
    LSP.ShowDocumentResult | null,
  ];
  "textDocument/linkedEditingRange": [
    LSP.LinkedEditingRangeParams,
    LSP.LinkedEditingRanges | null | null,
  ];
  "workspace/willCreateFiles": [
    LSP.CreateFilesParams,
    LSP.WorkspaceEdit | null | null,
  ];
  "workspace/willRenameFiles": [
    LSP.RenameFilesParams,
    LSP.WorkspaceEdit | null | null,
  ];
  "workspace/willDeleteFiles": [
    LSP.DeleteFilesParams,
    LSP.WorkspaceEdit | null | null,
  ];
  "textDocument/moniker": [LSP.MonikerParams, LSP.Moniker[] | null | null];
  "textDocument/prepareTypeHierarchy": [
    LSP.TypeHierarchyPrepareParams,
    LSP.TypeHierarchyItem[] | null | null,
  ];
  "typeHierarchy/supertypes": [
    LSP.TypeHierarchySupertypesParams,
    LSP.TypeHierarchyItem[] | null | null,
  ];
  "typeHierarchy/subtypes": [
    LSP.TypeHierarchySubtypesParams,
    LSP.TypeHierarchyItem[] | null | null,
  ];
  "textDocument/inlineValue": [
    LSP.InlineValueParams,
    LSP.InlineValue[] | null | null,
  ];
  "workspace/inlineValue/refresh": [any, null | null];
  "textDocument/inlayHint": [
    LSP.InlayHintParams,
    LSP.InlayHint[] | null | null,
  ];
  "inlayHint/resolve": [LSP.InlayHint, LSP.InlayHint | null];
  "workspace/inlayHint/refresh": [any, null | null];
  "textDocument/diagnostic": [
    LSP.DocumentDiagnosticParams,
    LSP.DocumentDiagnosticReport | null,
  ];
  "workspace/diagnostic": [
    LSP.WorkspaceDiagnosticParams,
    LSP.WorkspaceDiagnosticReport | null,
  ];
  "workspace/diagnostic/refresh": [any, null | null];
  "textDocument/inlineCompletion": [
    LSP.InlineCompletionParams,
    LSP.InlineCompletionList | LSP.InlineCompletionItem[] | null | null,
  ];
  "client/registerCapability": [LSP.RegistrationParams, null | null];
  "client/unregisterCapability": [LSP.UnregistrationParams, null | null];
  initialize: [LSP.InitializeParams, LSP.InitializeResult | null];
  shutdown: [any, null | null];
  "window/showMessageRequest": [
    LSP.ShowMessageRequestParams,
    LSP.MessageActionItem | null | null,
  ];
  "textDocument/willSaveWaitUntil": [
    LSP.WillSaveTextDocumentParams,
    LSP.TextEdit[] | null | null,
  ];
  "textDocument/completion": [
    LSP.CompletionParams,
    LSP.CompletionItem[] | LSP.CompletionList | null | null,
  ];
  "completionItem/resolve": [LSP.CompletionItem, LSP.CompletionItem | null];
  "textDocument/hover": [LSP.HoverParams, LSP.Hover | null | null];
  "textDocument/signatureHelp": [
    LSP.SignatureHelpParams,
    LSP.SignatureHelp | null | null,
  ];
  "textDocument/definition": [
    LSP.DefinitionParams,
    LSP.Definition | LSP.DefinitionLink[] | null | null,
  ];
  "textDocument/references": [
    LSP.ReferenceParams,
    LSP.Location[] | null | null,
  ];
  "textDocument/documentHighlight": [
    LSP.DocumentHighlightParams,
    LSP.DocumentHighlight[] | null | null,
  ];
  "textDocument/documentSymbol": [
    LSP.DocumentSymbolParams,
    LSP.SymbolInformation[] | LSP.DocumentSymbol[] | null | null,
  ];
  "textDocument/codeAction": [
    LSP.CodeActionParams,
    (LSP.Command | LSP.CodeAction)[] | null | null,
  ];
  "codeAction/resolve": [LSP.CodeAction, LSP.CodeAction | null];
  "workspace/symbol": [
    LSP.WorkspaceSymbolParams,
    LSP.SymbolInformation[] | LSP.WorkspaceSymbol[] | null | null,
  ];
  "workspaceSymbol/resolve": [LSP.WorkspaceSymbol, LSP.WorkspaceSymbol | null];
  "textDocument/codeLens": [LSP.CodeLensParams, LSP.CodeLens[] | null | null];
  "codeLens/resolve": [LSP.CodeLens, LSP.CodeLens | null];
  "workspace/codeLens/refresh": [any, null | null];
  "textDocument/documentLink": [
    LSP.DocumentLinkParams,
    LSP.DocumentLink[] | null | null,
  ];
  "documentLink/resolve": [LSP.DocumentLink, LSP.DocumentLink | null];
  "textDocument/formatting": [
    LSP.DocumentFormattingParams,
    LSP.TextEdit[] | null | null,
  ];
  "textDocument/rangeFormatting": [
    LSP.DocumentRangeFormattingParams,
    LSP.TextEdit[] | null | null,
  ];
  "textDocument/rangesFormatting": [
    LSP.DocumentRangesFormattingParams,
    LSP.TextEdit[] | null | null,
  ];
  "textDocument/onTypeFormatting": [
    LSP.DocumentOnTypeFormattingParams,
    LSP.TextEdit[] | null | null,
  ];
  "textDocument/rename": [LSP.RenameParams, LSP.WorkspaceEdit | null | null];
  "textDocument/prepareRename": [
    LSP.PrepareRenameParams,
    LSP.PrepareRenameResult | null | null,
  ];
  "workspace/executeCommand": [
    LSP.ExecuteCommandParams,
    LSP.LSPAny | null | null,
  ];
  "workspace/applyEdit": [
    LSP.ApplyWorkspaceEditParams,
    LSP.ApplyWorkspaceEditResult | null,
  ];
}

export interface LSPNotifyMap {
  "workspace/didChangeWorkspaceFolders": LSP.DidChangeWorkspaceFoldersParams;
  "window/workDoneProgress/cancel": LSP.WorkDoneProgressCancelParams;
  "workspace/didCreateFiles": LSP.CreateFilesParams;
  "workspace/didRenameFiles": LSP.RenameFilesParams;
  "workspace/didDeleteFiles": LSP.DeleteFilesParams;
  "notebookDocument/didOpen": LSP.DidOpenNotebookDocumentParams;
  "notebookDocument/didChange": LSP.DidChangeNotebookDocumentParams;
  "notebookDocument/didSave": LSP.DidSaveNotebookDocumentParams;
  "notebookDocument/didClose": LSP.DidCloseNotebookDocumentParams;
  initialized: LSP.InitializedParams;
  exit: any;
  "workspace/didChangeConfiguration": LSP.DidChangeConfigurationParams;
  "window/showMessage": LSP.ShowMessageParams;
  "window/logMessage": LSP.LogMessageParams;
  "telemetry/event": LSP.LSPAny;
  "textDocument/didOpen": LSP.DidOpenTextDocumentParams;
  "textDocument/didChange": LSP.DidChangeTextDocumentParams;
  "textDocument/didClose": LSP.DidCloseTextDocumentParams;
  "textDocument/didSave": LSP.DidSaveTextDocumentParams;
  "textDocument/willSave": LSP.WillSaveTextDocumentParams;
  "workspace/didChangeWatchedFiles": LSP.DidChangeWatchedFilesParams;
  "textDocument/publishDiagnostics": LSP.PublishDiagnosticsParams;
  "$/setTrace": LSP.SetTraceParams;
  "$/logTrace": LSP.LogTraceParams;
}
