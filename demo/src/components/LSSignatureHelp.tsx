import type { JSX } from "react";
import type * as LSP from "vscode-languageserver-protocol";
import { LowLightCodeBlock, LSContents } from "./LSContents";

interface LSPContentsProps {
  data: LSP.SignatureHelp;
  activeSignature: number;
  activeParameter?: number;
}

export function LSSignatureHelp({
  data,
  activeParameter,
}: LSPContentsProps): JSX.Element {
  return (
    <div>
      {data.signatures.map((line) => (
        <LSSignatureHelpLine
          key={data.signatures.indexOf(line)}
          line={line}
          activeParameterIndex={activeParameter}
        />
      ))}
    </div>
  );
}

function LSSignatureHelpLine({
  line,
  activeParameterIndex,
}: {
  line: LSP.SignatureInformation;
  activeParameterIndex?: number;
}): JSX.Element {
  const activeParameter =
    activeParameterIndex !== undefined
      ? line.parameters?.[activeParameterIndex]
      : undefined;
  const activeParameterStr =
    typeof activeParameter?.label === "string" ? activeParameter.label : "";

  const before = line.label.split(activeParameterStr).at(0);
  const after = line.label.split(activeParameterStr).at(1);

  if (activeParameterStr) {
    return (
      <div className="mx-1 text-xs">
        {before && after && (
          <div>
            <LowLightCodeBlock
              language="typescript"
              code={before}
              className="text-xs"
            />
            <LowLightCodeBlock
              language="typescript"
              code={activeParameterStr}
              className="text-xs font-extrabold underline"
            />
            <LowLightCodeBlock
              language="typescript"
              code={after}
              className="text-xs"
            />
          </div>
        )}
        {line.documentation && <LSContents contents={line.documentation} />}
        {activeParameter?.documentation && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <LSContents
              contents={activeParameter.documentation}
              className="text-xs"
            />
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div className="mx-1">
        <LowLightCodeBlock
          language="typescript"
          code={line.label}
          className="text-xs"
        />
        {line.documentation && <LSContents contents={line.documentation} />}
      </div>
    );
  }
}
