import { useCallback, useEffect, useState } from "react";
import type { ProjectMeta } from "shared/types";
import { atom, useAtom, useAtomValue } from "jotai";
import { activeProjectFilesAtom } from "app/hooks/useProjectCodeEditor";
import { LSClient } from "vtlsp/codemirror-lsp/src/LSClient";
import { LSWebSocketTransport } from "vtlsp/codemirror-lsp/src/transport/websocket/LSWebSocketTransport";
import { getLsUrl } from "./lsUtils";

/*
 * Simplified useLsClient - manages a direct LSClient connection without
 * automatic reconnection, auth, or complex session management.
 */

export type LSConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "healthy";

export const lsStateAtom = atom<LSConnectionState>("disconnected");
const lsClientAtom = atom<LSClient | null>(null);

interface LSClientResult {
  lsClient: LSClient | null;
  connectionState: LSConnectionState;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useLsClient({
  project,
}: {
  project: ProjectMeta;
}): LSClientResult {
  const activeProjectFiles = useAtomValue(activeProjectFilesAtom);
  const [connectionState, setConnectionState] = useAtom(lsStateAtom);
  const [lsClient, setLsClient] = useAtom(lsClientAtom);
  const [transport, setTransport] = useState<LSWebSocketTransport | null>(null);

  const getSessionId = useCallback((project: ProjectMeta): string => {
    return project.id + project.branch.id;
  }, []);

  const getUri = useCallback(
    (project: ProjectMeta) => {
      const url = new URL(getLsUrl({ route: "ws", worker: false }));
      url.searchParams.set("session", getSessionId(project));
      return url.toString();
    },
    [getSessionId],
  );

  const createTransport = useCallback(
    (project: ProjectMeta) => {
      return new LSWebSocketTransport(getUri(project), {
        onWSOpen: () => {
          setConnectionState("connected");
        },
        onLSHealthy: () => {
          setConnectionState("healthy");
        },
        onWSClose: () => {
          setConnectionState("disconnected");
        },
        onWSError: () => {
          setConnectionState("disconnected");
        },
      });
    },
    [getUri],
  );

  const createClient = useCallback((transport: LSWebSocketTransport) => {
    return new LSClient({
      transport,
      workspaceFolders: [{ uri: "file:///", name: "Val" }],
      autoClose: false,
      initializationOptions: {
        enable: true,
        unstable: true,
      },
    });
  }, []);

  const reinitFiles = useCallback(
    async (client: LSClient) => {
      if (!activeProjectFiles) return;

      await client.notifyUnsafe("vtlsp/reinitFiles", {
        files: activeProjectFiles
          .filter((file) => file.content !== null)
          .map((file) => {
            const filePath = file.path.join("/");
            return {
              uri: `file:///${filePath}`,
              text: file.content as string,
            };
          }),
      });
    },
    [activeProjectFiles],
  );

  const connect = useCallback(async () => {
    if (transport?.connected()) {
      return;
    }

    setConnectionState("connecting");

    const newTransport = createTransport(project);
    const newClient = createClient(newTransport);

    setTransport(newTransport);
    setLsClient(newClient);

    try {
      await newTransport.connect();
      await newClient.initialize(true);
      await reinitFiles(newClient);
    } catch (error) {
      setConnectionState("disconnected");
      throw error;
    }
  }, [transport, createTransport, createClient, project, reinitFiles]);

  const disconnect = useCallback(() => {
    transport?.dispose();
    setTransport(null);
    setLsClient(null);
    setConnectionState("disconnected");
  }, [transport]);

  return {
    lsClient,
    connectionState,
    connect,
    disconnect,
  };
}
