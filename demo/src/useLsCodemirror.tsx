import { LSContents } from "./components/LSContents";
import { useMemo, useCallback, useState } from "react";
import ReactDOM from "react-dom/client";
import { LSContextMenu } from "./components/LSContextMenu";
import { LSSignatureHelp } from "./components/LSSignatureHelp";
import { LSGoTo } from "./components/LSGoTo";
import { LSWindow } from "./components/LSWindow";
import type * as LSP from "vscode-languageserver-protocol";
import {
  languageServerWithClient,
  LSClient,
  LSWebSocketTransport,
} from "codemirror-ls";

export function useLsCodemirror({ path }: { path: string }): {
  extensions: ReturnType<typeof languageServerWithClient> | null;
  connect: (url: string) => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
} {
  const [lsClient, setLsClient] = useState<LSClient | null>(null);
  const [transport, setTransport] = useState<LSWebSocketTransport | null>(null);

  const connect = useCallback(
    async (url: string) => {
      if (transport) {
        transport.dispose();
        setTransport(null);
        setLsClient(null);
      }

      const newTransport = new LSWebSocketTransport(url, {});
      const newClient = new LSClient({
        transport: newTransport,
        workspaceFolders: [{ uri: "file:///demo", name: "Demo" }],
      });

      setTransport(newTransport);
      setLsClient(newClient);

      try {
        await newTransport.connect();
        await newClient.initialize(true);
      } catch (error) {
        setTransport(null);
        setLsClient(null);
        throw error;
      }
    },
    [transport],
  );

  const disconnect = useCallback(() => {
    transport?.dispose();
    setTransport(null);
    setLsClient(null);
  }, [transport]);

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
      documentUri: `file://${path}`,
      languageId: "typescript",
      sendIncrementalChanges: false,
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
        renames: {},
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
          render: async (dom, callbacks) => {
            const container = document.createElement("div");
            container.classList.add("ls-context-menu-container");
            const root = ReactDOM.createRoot(container);
            root.render(<LSContextMenu {...callbacks} />);
            dom.appendChild(container);
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
          modClickForDefinition: true,
        },
        window: {
          render: async (dom, message: LSP.ShowMessageParams, onDismiss) => {
            const root = ReactDOM.createRoot(dom);
            root.render(<LSWindow message={message} onDismiss={onDismiss} />);
          },
        },
      },
    });

    return lspExtensions;
  }, [lsClient, path]);

  return {
    extensions,
    connect,
    disconnect,
    isConnected: !!lsClient,
  };
}
