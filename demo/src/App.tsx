import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { useLsCodemirror } from "./useLsCodemirror";

const DEFAULT_URL_BASE = () =>
  window.location.hostname === "localhost"
    ? `ws://${window.location.hostname}:5002/ws?session=${crypto.randomUUID()}`
    : `wss://${window.location.hostname}/lsp?session=${crypto.randomUUID()}`;

export default function App() {
  const editor = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [url, setUrl] = useState(DEFAULT_URL_BASE());
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    extensions: lsExtensions,
    connect,
    isConnected,
  } = useLsCodemirror({
    path: "/demo.ts",
  });

  useEffect(() => {
    if (editor.current && !view.current && lsExtensions) {
      const state = EditorState.create({
        doc: "export function add(a: number, b: number) {\n return a + b;\n }\n\n add(12, 14)\n\n\n",
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          lsExtensions,
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
          {isConnecting ? "..." : isConnected ? "Reconnect" : "Connect"}
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>
      <div className="flex-1" ref={editor} />
    </div>
  );
}
