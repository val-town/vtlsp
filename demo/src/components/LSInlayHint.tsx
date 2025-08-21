import * as LSP from "vscode-languageserver-protocol";

interface LSInlayHintProps {
  hint: LSP.InlayHint;
}

export function LSInlayHint({ hint }: LSInlayHintProps) {
  if (!hint) {
    return null;
  }

  const label = typeof hint.label === 'string' ? hint.label : hint.label.map(part => part.value).join('');
  const paddingLeft = hint.paddingLeft ? '1px' : '0px';
  const paddingRight = hint.paddingRight ? '1px' : '0px';

  const color = hint.kind === LSP.InlayHintKind.Type
    ? 'text-stone-500'
    : 'text-gray-500'

  return (
    <span
      className={`inline-block text-xs italic mx-[1px] ${color}`}
      style={{ paddingLeft, paddingRight }}
    >
      {label}
    </span>
  );
}
