import { useMemo, useState, useEffect, useRef } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { Compartment, Facet } from "@codemirror/state";
import { useLsCodemirror } from "./useLsCodemirror";
import { useCodeMirror } from '@uiw/react-codemirror';

const DEFAULT_CODE = "console.log('hello world!');\n\n\n";

export default function App() {
  const editor = useRef<HTMLDivElement>(null);
  const lsCompartment = useRef(new Compartment());
  const [url, setUrl] = useState(
    `ws://localhost:5002?session=${crypto.randomUUID()}`,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(DEFAULT_CODE);

  const { extensions: lsExtensions, connect, disconnect, isConnected } = useLsCodemirror({
    path: "/demo.ts",
  });

  const extensions = useMemo(() => {
    return [
      javascript(),
      lsCompartment.current.of(lsExtensions || [])
    ];
  }, [lsExtensions]);

  const { setContainer, view } = useCodeMirror({
    container: editor.current,
    extensions,
    value,
    onChange: setValue,
  });

  useEffect(() => {
    if (editor.current) {
      setContainer(editor.current);
    }
  }, [setContainer]);

  useEffect(() => {
    if (view && lsExtensions) {
      view.dispatch({
        effects: lsCompartment.current.reconfigure(lsExtensions)
      });
    }
  }, [view, lsExtensions]);

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