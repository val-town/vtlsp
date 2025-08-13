import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { useLsCodemirror } from "./useLsCodemirror";

export default function App() {
  const editor = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [url, setUrl] = useState(
    `ws://localhost:5002?session=${crypto.randomUUID()}`,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    extensions: lsExtensions,
    connect,
    disconnect,
    isConnected,
  } = useLsCodemirror({
    path: "/demo.ts",
  });

  useEffect(() => {
    if (editor.current && !view.current && lsExtensions) {
      const state = EditorState.create({
        doc: "console.log('hello world!');\n\n\n",
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          lsExtensions,
          EditorView.updateListener.of((update) => {
            // biome-ignore lint/suspicious/noConsole: debugging
            console.log("Editor updated:", update);
          }),
        ],
      });

      view.current = new EditorView({
        state,
        parent: editor.current,
      });
    }

    return () => {
      if (view.current) {
        view.current.destroy();
        view.current = null;
      }
    };
  }, [lsExtensions]);

  const handleConnect = async () => {
    if (isConnected) {
      disconnect();
      setError(null);
      return;
    }

    setIsConnecting(true);
    setError(null);
    try {
      await connect(url);
    } catch (error) {
      setError(
        `Connection failed ${error instanceof Error ? `: ${error.message}` : ""}`,
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="p-2 flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="WebSocket URL"
          className="flex-1 px-2 py-1 border rounded text-sm"
          disabled={isConnecting}
        />
        <button
          type="button"
          onClick={handleConnect}
          disabled={isConnecting}
          className="px-3 py-1 border rounded text-sm"
        >
          {isConnecting ? "..." : isConnected ? "Disconnect" : "Connect"}
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>
      <div className="flex-1" ref={editor} />
    </div>
  );
}
