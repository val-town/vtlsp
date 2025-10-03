import { LSClient, languageServerWithClient } from "@valtown/codemirror-ls";
import { LSWebSocketTransport } from "@valtown/codemirror-ls/transport";
import { useCallback, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import type * as LSP from "vscode-languageserver-protocol";
import { LSContents } from "./components/LSContents";
import { LSContextMenu } from "./components/LSContextMenu";
import { LSGoTo } from "./components/LSGoTo";
import { LSInlayHint } from "./components/LSInlayHint";
import { LSRename } from "./components/LSRename";
import { LSSignatureHelp } from "./components/LSSignatureHelp";
import { LSWindow } from "./components/LSWindow";
import { showDialog } from "@codemirror/view";

export function useLsCodemirror({ path }: { path: string }): {
  extensions: ReturnType<typeof languageServerWithClient> | null;
  connect: (url: string) => Promise<void>;
  isConnected: boolean;
} {
  const [lsClient, setLsClient] = useState<LSClient | null>(null);
  const [transport, setTransport] = useState<LSWebSocketTransport | null>(null);

  const connect = useCallback(
    async (url: string) => {
      const hadTransport = !!transport;

      if (transport) {
        transport.dispose();
        setTransport(null);
        setLsClient(null);
      }

      const newTransport = new LSWebSocketTransport(url, {});
      const newClient = new LSClient({
        transport: newTransport,
        workspaceFolders: [{ uri: "file:///demo", name: "Demo" }],
        initializationOptions: {
          // Deno needs this to enable inlay hints
          inlayHints: {
            parameterNames: {
              enabled: "all",
              suppressWhenArgumentMatchesName: true,
            },
            parameterTypes: { enabled: true },
            variableTypes: { enabled: true, suppressWhenTypeMatchesName: true },
            propertyDeclarationTypes: { enabled: true },
            functionLikeReturnTypes: { enabled: true },
            enumMemberValues: { enabled: true },
          },
        },
      });

      setTransport(newTransport);
      setLsClient(newClient);

      await newTransport.connect();
      if (hadTransport) {
        newClient.changeTransport(newTransport);
        newClient.initialize();
      }
    },
    [transport],
  );

  const extensions = useMemo(() => {
    if (!lsClient) return null;

    const renderContents = async (
      dom: HTMLElement,
      contents:
        | string
        | LSP.MarkupContent
        | LSP.MarkedString
        | LSP.MarkedString[],
    ) => {
      const root = ReactDOM.createRoot(dom);
      root.render(<LSContents contents={contents} />);
    };

    const lspExtensions = languageServerWithClient({
      client: lsClient,
      onError: (error, view) => {
        // Codemirror's native "dock" area for dialogs
        showDialog(view, { label: error.message })
      },
      documentUri: `file://${path}`,
      languageId: "typescript",
      sendDidOpen: true,
      features: {
        signatureHelp: {
          render: async (dom, data, activeSignature, activeParameter) => {
            dom.style.cssText = `
              max-width: 600px; 
              max-height: 300px; 
              overflow: auto; 
              margin: 12px; 
              transform: translateY(-16px);
            `;
            const root = ReactDOM.createRoot(dom);
            root.render(
              <LSSignatureHelp
                data={data}
                activeParameter={activeParameter}
                activeSignature={activeSignature}
              />,
            );
          },
        },
        hovers: {
          render: renderContents,
        },
        renames: {
          render: async (dom, placeholder, onClose, onComplete) => {
            const root = ReactDOM.createRoot(dom);
            root.render(
              <LSRename
                placeholder={placeholder}
                onDismiss={onClose}
                onComplete={(newName) => {
                  onComplete(newName);
                  onClose();
                }}
              />,
            );
          },
        },
        linting: {
          render: async (dom, message) => {
            const root = ReactDOM.createRoot(dom);
            root.render(<LSContents contents={message} />);
          },
        },
        completion: {
          completionMatchBefore: /.+/,
          render: renderContents,
        },
        contextMenu: {
          render: async (dom, callbacks, onDismiss) => {
            const container = document.createElement("div");
            container.classList.add("ls-context-menu-container");
            const root = ReactDOM.createRoot(container);
            root.render(<LSContextMenu {...callbacks} onDismiss={onDismiss} />);
            dom.appendChild(container);
          },
          referencesArgs: {
            onExternalReference: (uri) => {
              // biome-ignore lint/suspicious/noConsole: for demo
              console.log("Go to external reference from context menu", uri);
            },
          },
        },
        references: {
          render: async (dom, references, goToReference, onClose, kind) => {
            const root = ReactDOM.createRoot(dom);
            root.render(
              <LSGoTo
                onClose={onClose}
                locations={references}
                goTo={goToReference}
                kind={kind}
              />,
            );
          },
          onExternalReference: (uri) => {
            // biome-ignore lint/suspicious/noConsole: for demo
            console.log("Go to external reference", uri);
          },
          modClickForDefinition: true,
        },
        window: {
          render: async (dom, message: LSP.ShowMessageParams, onDismiss) => {
            const root = ReactDOM.createRoot(dom);
            root.render(<LSWindow message={message} onDismiss={onDismiss} />);
          },
        },
        inlayHints: {
          render: async (dom, hints) => {
            const root = ReactDOM.createRoot(dom);
            const hint = Array.isArray(hints) ? hints[0] : hints;
            root.render(<LSInlayHint hint={hint} />);
          },
        },
      },
    });

    return lspExtensions;
  }, [lsClient, path]);

  return {
    extensions,
    connect,
    isConnected: !!lsClient,
  };
}
