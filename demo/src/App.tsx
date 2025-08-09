import { useEffect, useRef } from "react";
import { useCodeMirror } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";

const code = "console.log('hello world!');\n\n\n";
const extensions = [javascript()];

export default function App() {
  const editor = useRef(null);
  const { setContainer } = useCodeMirror({
    container: editor.current,
    extensions,
    value: code,
  });

  useEffect(() => {
    if (editor.current) {
      setContainer(editor.current);
    }
  }, [editor.current]);

  return <div ref={editor} />;
}
