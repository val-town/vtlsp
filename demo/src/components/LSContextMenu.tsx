import type { ContextMenuCallbacks } from "codemirror-ls";
import { Code2, Edit3, MousePointer2, Search, Type } from "lucide-react";

export function LSContextMenu({
  goToDefinition,
  goToTypeDefinition,
  goToImplementation,
  findAllReferences,
  rename,
}: ContextMenuCallbacks) {
  return (
    <div className="flex flex-col">
      <LSContextMenuButton
        onClick={goToDefinition}
        icon={<MousePointer2 size={14} />}
      >
        Go to Definition
      </LSContextMenuButton>
      <LSContextMenuButton
        onClick={goToTypeDefinition}
        icon={<Type size={14} />}
      >
        Go to Type Definition
      </LSContextMenuButton>
      <LSContextMenuButton
        onClick={goToImplementation}
        icon={<Code2 size={14} />}
      >
        Go to Implementation
      </LSContextMenuButton>
      <LSContextMenuButton
        onClick={findAllReferences}
        icon={<Search size={14} />}
      >
        Find All References
      </LSContextMenuButton>
      <LSContextMenuButton onClick={rename} icon={<Edit3 size={14} />}>
        Rename Symbol
      </LSContextMenuButton>
    </div>
  );
}

function LSContextMenuButton({
  onClick,
  children,
  icon,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 first:rounded-t last:rounded-b"
    >
      {icon}
      {children}
    </button>
  );
}
