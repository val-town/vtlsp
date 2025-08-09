import { LSContents } from "./components/LSContents";
import { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { useLsClient } from "./useLsClient";
import { trpc } from "app/integrations/trpcClient";
import type { ProjectMeta } from "shared/types";
import { useProjectLink } from "app/components/projects/useProjectLink";
import { useNavigate } from "react-router";
import { useAtom, useSetAtom } from "jotai";
import {
  lsExternalDocumentConfig,
  lsPrevExternalDocumentConfig,
} from "./components/LSExternalDocumentDialog";
import { URI } from "vscode-uri";
import z from "zod";
import { LSContextMenu } from "./components/LSContextMenu";
import { languageServerWithClient } from "vtlsp/codemirror-lsp/src";
import { LSSignatureHelp } from "./components/LSSignatureHelp";
import { LSGoTo } from "./components/LSGoTo";
import { LSWindow } from "./components/LSWindow";
import type * as LSP from "vscode-languageserver-protocol";
import type { OnExternalReferenceCallback } from "vtlsp/codemirror-lsp/src/extensions/references";

export function useLsCodemirror({
  project,
  path,
}: {
  project: ProjectMeta;
  path: string;
}): {
  extensions: ReturnType<typeof languageServerWithClient>;
} {
  const { lsClient, ensureConnected, pauseHeartbeat, resumeHeartbeat } =
    useLsClient({ project });
  const [currentExternalDocument, setExternalDocument] = useAtom(
    lsExternalDocumentConfig
  );
  const setPreviousExternalDocument = useSetAtom(lsPrevExternalDocumentConfig);

  const projectEnvVars = trpc.projects.envVars.useQuery({
    projectId: project.id,
  });

  useEffect(() => {
    const onFocusIn = () => {
      void resumeHeartbeat();
      // Ensure the LS client is connected when the window gains focus
      void ensureConnected();
    };

    const onFocusOut = () => {
      void pauseHeartbeat();
    };

    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    return () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, [ensureConnected, pauseHeartbeat, resumeHeartbeat]);

  useEffect(() => {
    if (!lsClient) return;

    lsClient.initializePromise.then(() => {
      lsClient.notifyUnsafe("vtlsp/envVars", {
        envVars: [
          ...(projectEnvVars.data?.map((env) => ({
            key: env.key,
            description: env.description,
          })) ?? []),
          {
            key: "valtown",
            description: "Val Town API key",
          },
          {
            key: "VAL_TOWN_API_KEY",
            description: "Val Town API key",
          },
        ],
      });
    });
  }, [lsClient, projectEnvVars.data]);

  const getFileLink = useProjectLink({ useID: false });
  const navigate = useNavigate();

  const extensions = useMemo(() => {
    if (!lsClient) return null;

    const renderContents = async (dom: HTMLElement, contents: any) => {
      const root = ReactDOM.createRoot(dom);
      root.render(LSContents({ contents }));
    };

    const onExternalReference: OnExternalReferenceCallback = (e) => {
      let uri = URI.parse(e.uri);

      // Handle special case for deno: scheme URIs that are incorrectly prefixed with file://
      if (uri.scheme === "file" && uri.path.startsWith("/deno:")) {
        // Extract the deno: part and create proper deno: URI
        const denoPath = uri.path.slice(6); // Remove '/deno:' prefix
        uri = uri.with({ scheme: "deno", path: denoPath });
      } else {
        // Fix path by removing duplicate "file:" prefix if present
        const cleanPath = uri.path.startsWith("/file:")
          ? uri.path.slice(6)
          : uri.path;
        uri = uri.with({ path: decodeURIComponent(cleanPath) });
      }

      if (uri.path !== path) {
        if (uri.scheme !== "file") {
          lsClient
            .requestUnsafe("deno/virtualTextDocument", {
              textDocument: { uri: uri.toString() },
            })
            .then((text: string) => {
              // Store current as previous before setting new
              setPreviousExternalDocument(currentExternalDocument);
              setExternalDocument({
                lineStart: e.range.start.line + 1,
                lineEnd: e.range.end.line + 1,
                // Old vals used to not end with `.ts` or `.tsx`. When we go to definition
                // for a virtual file without an extension, then the LSP refuses to work
                // inside that file.
                path: /(\.\w+)$/.test(uri.toString())
                  ? uri.toString() // it has an extension already
                  : `file:///tmp/${encodeURIComponent(uri.toString())}.tsx`, // use a fake file with a .tsx extension
                text: text,
              });
            });
        } else if (!uri.path.includes(".deno_dir")) {
          const newLink = getFileLink(uri.path.slice(1));
          navigate(
            `${newLink}#L${e.range.start.line + 1}-${e.range.end.line + 1}`
          );
        } else {
          lsClient
            .requestUnsafe("vtlsp/readFile", {
              textDocument: { uri: uri.toString() },
            })
            .then(({ text }: { text: string }) => {
              // Store current as previous before setting new
              setPreviousExternalDocument(currentExternalDocument);
              setExternalDocument({
                path: uri.toString(),
                text: text,
                lineStart: e.range.start.line + 1,
                lineEnd: e.range.end.line + 1,
              });
            });
        }
      }
    }

    const lspExtensions = languageServerWithClient({
      client: lsClient,
      // If it's a URL, use it directly; otherwise, treat it as a file path
      documentUri: z.string().url().safeParse(path).success
        ? path
        : `file://${path}`,
      languageId: "typescript",
      sendIncrementalChanges: false,
      sendDidOpen: true,
      features: {
        signatureHelp: {
          render: async (dom, data, activeSignature, activeParameter) => {
            dom.style = `max-width: 600px; max-height: 300px; overflow: auto; margin: 12px; transform: translateY(-16px);`;
            const root = ReactDOM.createRoot(dom);
            root.render(
              <LSSignatureHelp
                data={data}
                activeParameter={activeParameter}
                activeSignature={activeSignature}
              />
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
              />
            );
          },
          modClickForDefinition: true,
          onExternalReference,
        },
        window: {
          render: async (dom, message: LSP.ShowMessageParams, onDismiss) => {
            const root = ReactDOM.createRoot(dom);
            root.render(<LSWindow message={message} onDismiss={onDismiss} />);
          },
        },
      },
    });

    return [...lspExtensions];
  }, [
    lsClient,
    path,
    navigate,
    getFileLink,
    currentExternalDocument,
    setExternalDocument,
    setPreviousExternalDocument,
  ]);

  return {
    // Use a copied array to avoid mutation issues
    extensions: [...(extensions || [])],
  };
}
