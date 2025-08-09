import { useCallback, useEffect, useState } from "react";
import { atom, useAtom } from "jotai";

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

export function useLsClient(): LSClientResult {
  const [connectionState, setConnectionState] = useAtom(lsStateAtom);
  const [lsClient, setLsClient] = useAtom(lsClientAtom);
  const [transport, setTransport] = useState<LSWebSocketTransport | null>(null);

  const createTransport = useCallback(() => {
    // Use a basic TypeScript language server WebSocket endpoint
    const wsUrl = "ws://localhost:3001/typescript-lsp";

    return new LSWebSocketTransport(wsUrl, {
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
  }, []);

  const createClient = useCallback((transport: LSWebSocketTransport) => {
    return new LSClient({
      transport,
      workspaceFolders: [{ uri: "file:///demo", name: "Demo" }],
      autoClose: false,
      initializationOptions: {
        preferences: {
          includeCompletionsForModuleExports: true,
          includeCompletionsWithInsertText: true,
        },
      },
    });
  }, []);

  const connect = useCallback(async () => {
    if (transport?.connected()) {
      return;
    }

    setConnectionState("connecting");

    const newTransport = createTransport();
    const newClient = createClient(newTransport);

    setTransport(newTransport);
    setLsClient(newClient);

    try {
      await newTransport.connect();
      await newClient.initialize(true);
    } catch (error) {
      setConnectionState("disconnected");
      throw error;
    }
  }, [transport, createTransport, createClient]);

  const disconnect = useCallback(() => {
    transport?.dispose();
    setTransport(null);
    setLsClient(null);
    setConnectionState("disconnected");
  }, [transport]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return {
    lsClient,
    connectionState,
    connect,
    disconnect,
  };
}
