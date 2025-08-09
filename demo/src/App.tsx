import { useEffect, useRef, useState } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { useLsCodemirror } from "./useLsCodemirror";
import { EditorView } from "@codemirror/view";

const DEFAULT_CODE = "console.log('hello world!');\n\n\n";

export default function App() {
  const editor = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const [url, setUrl] = useState(
    `ws://localhost:5002?session=${crypto.randomUUID()}`,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { extensions, connect, disconnect, isConnected } = useLsCodemirror({
    path: "/demo.ts",
  });

  useEffect(() => {
    if (editor.current && !editorView.current) {
      const allExtensions = [javascript(), ...(extensions ? [extensions] : [])];

      const state = EditorState.create({
        doc: DEFAULT_CODE,
        extensions: allExtensions,
      });

      editorView.current = new EditorView({
        state,
        parent: editor.current,
      });
    }

    return () => {
      if (editorView.current) {
        editorView.current.destroy();
        editorView.current = null;
      }
    };
  }, [extensions]);

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
      // biome-ignore lint/suspicious/noConsole: debugging
      console.error("Failed to connect:", error);
      setError("Connection failed");
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
